import json
import random
import re
import socket
import ssl
import time
import urllib.parse

from flask import Flask, jsonify, request
import requests

app = Flask(__name__)

BUILT_IN_PROXIES = [
    'https://corsproxy.io/?',
    'https://api.codetabs.com/v1/proxy/?quest=',
    'https://yacdn.org/proxy/',
]

USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/126.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
]

TIMEOUT_SECONDS = 12


def random_user_agent():
    return random.choice(USER_AGENTS)


def normalize_target_url(target):
    if not target:
        raise ValueError('Target URL is required')
    cleaned = target.strip()
    if not re.match(r'^https?://', cleaned, re.I):
        cleaned = 'https://' + cleaned
    return cleaned


def proxy_request(target_url, method='GET', headers=None, stream=False, timeout=TIMEOUT_SECONDS):
    headers = headers or {}
    headers.setdefault('User-Agent', random_user_agent())

    last_error = None
    for proxy_base in BUILT_IN_PROXIES:
        proxy_url = proxy_base + urllib.parse.quote(target_url, safe='')
        try:
            response = requests.request(
                method,
                proxy_url,
                headers=headers,
                timeout=timeout,
                stream=stream,
                allow_redirects=True,
            )
            if response.status_code < 400:
                return response
            last_error = Exception(f'Proxy returned {response.status_code} for {proxy_url}')
        except Exception as exc:
            last_error = exc
            continue

    raise last_error if last_error else Exception('All proxies failed')


def dns_lookup_time(host):
    start = time.time()
    socket.getaddrinfo(host, None)
    return round((time.time() - start) * 1000)


def get_ssl_expiration_days(target_url):
    parsed = urllib.parse.urlparse(target_url)
    host = parsed.hostname
    port = parsed.port or 443
    if not host:
        return None

    context = ssl.create_default_context()
    with socket.create_connection((host, port), timeout=TIMEOUT_SECONDS) as sock:
        with context.wrap_socket(sock, server_hostname=host) as ssock:
            cert = ssock.getpeercert()
    not_after = cert.get('notAfter')
    if not not_after:
        return None
    expiration = ssl.cert_time_to_seconds(not_after)
    return max(0, int((expiration - time.time()) / 86400))


def fetch_dns_records(host):
    records = {}
    for record_type in ['A', 'AAAA', 'MX']:
        url = f'https://dns.google/resolve?name={urllib.parse.quote(host)}&type={record_type}'
        try:
            response = proxy_request(url)
            data = response.json()
            answers = data.get('Answer', [])
            values = [answer.get('data') for answer in answers if answer.get('data')]
            records[record_type] = values
        except Exception:
            records[record_type] = []
    return records


def get_geo_location(ip):
    try:
        url = f'https://ipinfo.io/{urllib.parse.quote(ip)}/json'
        response = proxy_request(url)
        return response.json()
    except Exception:
        return {'error': 'Unable to resolve geolocation'}


def parse_open_graph(html):
    tags = {}
    for match in re.finditer(r'<meta[^>]+>', html, re.I):
        element = match.group(0)
        prop_match = re.search(r'(?:property|name)=["\'](og:[^"\']+)["\']', element, re.I)
        content_match = re.search(r'content=["\']([^"\']+)["\']', element, re.I)
        if prop_match and content_match:
            tags[prop_match.group(1)] = content_match.group(1)
    return tags


def parse_resources(html, base_url):
    urls = set()
    for match in re.finditer(r'(?:src|href)=(["\'])(.*?)\1', html, re.I):
        url = match.group(2).strip()
        if not url or url.startswith('data:'):
            continue
        urls.add(urllib.parse.urljoin(base_url, url))
    return list(urls)


def weight_breakdown(target_url):
    response = proxy_request(target_url)
    html = response.text
    weights = {'html': len(html), 'scripts': 0, 'styles': 0, 'images': 0, 'other': 0, 'total': 0}
    urls = parse_resources(html, target_url)
    max_urls = urls[:25]
    for url in max_urls:
        category = 'other'
        if re.search(r'\.(js)(?:[?#]|$)', url, re.I):
            category = 'scripts'
        elif re.search(r'\.(css)(?:[?#]|$)', url, re.I):
            category = 'styles'
        elif re.search(r'\.(png|jpe?g|gif|svg|webp|avif)(?:[?#]|$)', url, re.I):
            category = 'images'

        try:
            head = proxy_request(url, method='HEAD')
            length = head.headers.get('Content-Length')
            size = int(length) if length and length.isdigit() else 0
        except Exception:
            size = 0

        weights[category] += size
    weights['total'] = weights['html'] + weights['scripts'] + weights['styles'] + weights['images'] + weights['other']
    return weights


@app.route('/api/performance', methods=['POST'])
def api_performance():
    payload = request.get_json() or {}
    target = payload.get('target', '')
    test_type = payload.get('testType', 'ttfb')

    try:
        target_url = normalize_target_url(target)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    parsed = urllib.parse.urlparse(target_url)
    host = parsed.hostname
    if not host:
        return jsonify({'error': 'Invalid target host'}), 400

    result = {}
    if test_type == 'ttfb' or test_type == 'all':
        ttfb_ms = None
        try:
            start = time.time()
            response = proxy_request(target_url, stream=True)
            response.raw.read(1)
            ttfb_ms = round((time.time() - start) * 1000)
        except Exception as exc:
            result['ttfbError'] = str(exc)
        else:
            result['ttfbMs'] = ttfb_ms

    if test_type == 'dns' or test_type == 'all':
        try:
            result['dnsMs'] = dns_lookup_time(host)
        except Exception as exc:
            result['dnsError'] = str(exc)

    if test_type == 'weight' or test_type == 'all':
        try:
            result['resourceWeight'] = weight_breakdown(target_url)
        except Exception as exc:
            result['weightError'] = str(exc)

    return jsonify(result)


@app.route('/api/security', methods=['POST'])
def api_security():
    payload = request.get_json() or {}
    target = payload.get('target', '')

    try:
        target_url = normalize_target_url(target)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    parsed = urllib.parse.urlparse(target_url)
    host = parsed.hostname
    if not host:
        return jsonify({'error': 'Invalid target host'}), 400

    result = {'securityHeaders': {}, 'dnsRecords': {}, 'geoLocation': {}}
    try:
        response = proxy_request(target_url)
        headers = response.headers
        result['securityHeaders'] = {
            'Content-Security-Policy': headers.get('Content-Security-Policy', ''),
            'Strict-Transport-Security': headers.get('Strict-Transport-Security', ''),
            'X-Content-Type-Options': headers.get('X-Content-Type-Options', ''),
            'X-Frame-Options': headers.get('X-Frame-Options', ''),
            'Referrer-Policy': headers.get('Referrer-Policy', ''),
        }
    except Exception as exc:
        result['securityHeadersError'] = str(exc)

    try:
        result['sslExpirationDays'] = get_ssl_expiration_days(target_url)
    except Exception as exc:
        result['sslExpirationError'] = str(exc)

    try:
        ips = socket.getaddrinfo(host, None)
        unique_ips = sorted({item[4][0] for item in ips})
        result['serverIps'] = unique_ips
        if unique_ips:
            result['geoLocation'] = get_geo_location(unique_ips[0])
    except Exception as exc:
        result['geoLocationError'] = str(exc)

    result['dnsRecords'] = fetch_dns_records(host)
    return jsonify(result)


@app.route('/api/preview', methods=['POST'])
def api_preview():
    payload = request.get_json() or {}
    target = payload.get('target', '')

    try:
        target_url = normalize_target_url(target)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    try:
        response = proxy_request(target_url)
        html = response.text
        tags = parse_open_graph(html)
        return jsonify({
            'url': target_url,
            'ogTags': tags,
            'title': tags.get('og:title', ''),
            'description': tags.get('og:description', ''),
            'image': tags.get('og:image', ''),
        })
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
