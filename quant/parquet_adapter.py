"""Read-only Arrow bridge. No collector, model deserializer, network or job runner imports."""
import argparse
import base64
import collections
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path, PureWindowsPath
import sqlite3
import sys

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

CATALOG = 'quant-parquet-catalog/v1'

# Fixed original-file bindings reviewed against primary notices; never a same-code fallback.
AUDITED_ALIAS_TEXTS = (
    '{"artifactSha256":"c03e83ffdc0634eb20152fa523d4b44c22403b1ceb0dd84b5dc52cb09c0db7e5","code":"000010","contentSha256":"0db3f284948b670cf1d1178c0ee84ad62e73aed4f6301e04fb703d4cf32e8038","directoryName":"*ST美丽","group":"datasets/a-share-qfq-20210828-20260828","legacyKey":"stock_search_index:6","manifestSha256":"ec27717255f5fd2b3db78891ca6ab703f446bff3eb47e4cd515d6349c68d2e65","market":"SZ","nativeId":"SZ:stock:000010","noticeSha256":"12ab155026c70a73a940fd3effb744db087181c1891c624309ab38537fa432e1","noticeUrl":"https://static.cninfo.com.cn/finalpage/2026-04-29/1225251716.PDF","path":"datasets/a-share-qfq-20210828-20260828/raw/000010.parquet","publicationDate":"2026-04-29","schema":"audited-parquet-alias/v1","scope":"identity-only; original prices/names/universe and historical ST intervals unchanged","sourceName":"美丽生态","statedEffectiveDate":"2026-04-30","type":"stock","universeSha256":"4e6743c66af9d784a0e69c21571b2d729ee7f63b8c1b5105a07d3247b3bca714"}',
    '{"artifactSha256":"c22e5127892b8c86ca3f6e0142b1a22bd7324ad75c337f7d687bff73f2e198e9","code":"000016","contentSha256":"f2fe3aaf86aef1219878dc3f7d959e1e852e7812cc64ab26c5467570ff41c587","directoryName":"*ST康佳A","group":"datasets/a-share-qfq-20210828-20260828","legacyKey":"stock_search_index:26","manifestSha256":"ec27717255f5fd2b3db78891ca6ab703f446bff3eb47e4cd515d6349c68d2e65","market":"SZ","nativeId":"SZ:stock:000016","noticeSha256":"666689e0a11d942153cdbfbad515ea6d91d31fe01c1f88c9bfb751f235637df1","noticeUrl":"https://disc.static.szse.cn/disc/disk03/finalpage/2026-04-29/33994a43-0f3a-4776-8857-ed8163a15ce6.PDF","path":"datasets/a-share-qfq-20210828-20260828/raw/000016.parquet","publicationDate":"2026-04-29","schema":"audited-parquet-alias/v1","scope":"identity-only; original prices/names/universe and historical ST intervals unchanged","sourceName":"深康佳Ａ","statedEffectiveDate":"2026-04-30","type":"stock","universeSha256":"4e6743c66af9d784a0e69c21571b2d729ee7f63b8c1b5105a07d3247b3bca714"}',
    '{"artifactSha256":"0d8aab4c56cfc3c7c34bfe50fceba5d6f065c8ed4f3730c19a8d0724abdf0180","code":"000639","contentSha256":"1a4c8c96466a72bc4dc3f979591e014a202cc68d68e9a5054b201bb6017fc087","directoryName":"ST西王","group":"datasets/a-share-qfq-20210828-20260828","legacyKey":"stock_search_index:201","manifestSha256":"ec27717255f5fd2b3db78891ca6ab703f446bff3eb47e4cd515d6349c68d2e65","market":"SZ","nativeId":"SZ:stock:000639","noticeSha256":"258fa47aa3e0cb80541cb5360c3e6758a4ae1c6d3acd3b5f4ab16d18930fa7ea","noticeUrl":"https://disc.static.szse.cn/disc/disk03/finalpage/2026-04-29/5dbc18ae-870e-4ceb-8149-299b34752f1d.PDF","path":"datasets/a-share-qfq-20210828-20260828/raw/000639.parquet","publicationDate":"2026-04-29","schema":"audited-parquet-alias/v1","scope":"identity-only; original prices/names/universe and historical ST intervals unchanged","sourceName":"西王食品","statedEffectiveDate":"2026-04-30","type":"stock","universeSha256":"4e6743c66af9d784a0e69c21571b2d729ee7f63b8c1b5105a07d3247b3bca714"}',
    '{"artifactSha256":"878976293cfd3f640d4af85e61ec02454983e0f66cd97656e7a09ec745216e06","code":"000672","contentSha256":"c4656e1fdb2bb3cf15e08e182aaa074fefa393c269a9d1704b96d88ff4c1bb41","directoryName":"上峰材料","group":"datasets/a-share-qfq-20210828-20260828","legacyKey":"stock_search_index:206","manifestSha256":"ec27717255f5fd2b3db78891ca6ab703f446bff3eb47e4cd515d6349c68d2e65","market":"SZ","nativeId":"SZ:stock:000672","noticeSha256":"d4bb8976647b38834d91c8e9088d8345a7149e29505348fc69022693385bb5c8","noticeUrl":"https://disc.static.szse.cn/disc/disk03/finalpage/2026-08-24/a12ae83b-2f18-47b0-8c79-a434aec51701.PDF","path":"datasets/a-share-qfq-20210828-20260828/raw/000672.parquet","publicationDate":"2026-08-24","schema":"audited-parquet-alias/v1","scope":"identity-only; original prices/names/universe and historical ST intervals unchanged","sourceName":"上峰水泥","statedEffectiveDate":null,"type":"stock","universeSha256":"4e6743c66af9d784a0e69c21571b2d729ee7f63b8c1b5105a07d3247b3bca714"}',
    '{"artifactSha256":"a83ec053e4ce91ea1575d71622f4538f08e808116917336693933823c2641ac7","code":"002082","contentSha256":"ba87912a7f91ce4923c49b415c52ba3ad2dd5054a1715bd7cc08cb29ae3db69b","directoryName":"ST万邦","group":"datasets/a-share-qfq-20210828-20260828","legacyKey":"stock_search_index:78","manifestSha256":"ec27717255f5fd2b3db78891ca6ab703f446bff3eb47e4cd515d6349c68d2e65","market":"SZ","nativeId":"SZ:stock:002082","noticeSha256":"a04d72cc9e7cf49b4a780dc99d84d6f9f7b68e5b1cc579feea5cb0d8ce5fac09","noticeUrl":"https://static.cninfo.com.cn/finalpage/2026-04-30/1225268899.PDF","path":"datasets/a-share-qfq-20210828-20260828/raw/002082.parquet","publicationDate":"2026-04-30","schema":"audited-parquet-alias/v1","scope":"identity-only; original prices/names/universe and historical ST intervals unchanged","sourceName":"万邦德","statedEffectiveDate":"2026-05-06","type":"stock","universeSha256":"4e6743c66af9d784a0e69c21571b2d729ee7f63b8c1b5105a07d3247b3bca714"}',
    '{"artifactSha256":"475c18d98a81616fcc16275135134e00302e06560a76dc6e22cfdbba27486228","code":"002694","contentSha256":"c76f2d4373e717fc38575aa7e901c3ca1962c611860c198be7f1b93ed8c0ac94","directoryName":"*ST顾地","group":"datasets/a-share-qfq-20210828-20260828","legacyKey":"stock_search_index:95","manifestSha256":"ec27717255f5fd2b3db78891ca6ab703f446bff3eb47e4cd515d6349c68d2e65","market":"SZ","nativeId":"SZ:stock:002694","noticeSha256":"2054d800e3d4b77f1381400fd2f3e92bfd88d325179f267f8fdddde230d99e5a","noticeUrl":"https://disc.static.szse.cn/download/disc/disk03/finalpage/2026-04-29/10d8c553-15c4-4167-9a61-94a46483db6e.PDF","path":"datasets/a-share-qfq-20210828-20260828/raw/002694.parquet","publicationDate":"2026-04-29","schema":"audited-parquet-alias/v1","scope":"identity-only; original prices/names/universe and historical ST intervals unchanged","sourceName":"顾地科技","statedEffectiveDate":"2026-04-30","type":"stock","universeSha256":"4e6743c66af9d784a0e69c21571b2d729ee7f63b8c1b5105a07d3247b3bca714"}',
    '{"artifactSha256":"873b3be1a60e5b3d924fe415b7015b5493ac5a0fb1dde3eae372a0f880925fa1","code":"300010","contentSha256":"6a6e53d58936c1570035dcfc26e3a6d54dc44c697f640edc065a06c73c2636c5","directoryName":"ST豆神","group":"datasets/a-share-qfq-20210828-20260828","legacyKey":"stock_search_index:196","manifestSha256":"ec27717255f5fd2b3db78891ca6ab703f446bff3eb47e4cd515d6349c68d2e65","market":"SZ","nativeId":"SZ:stock:300010","noticeSha256":"d38030809702101939401066c6dac2a87192e08b1a46767b15b813cda2634674","noticeUrl":"https://static.cninfo.com.cn/finalpage/2026-04-30/1225269274.PDF","path":"datasets/a-share-qfq-20210828-20260828/raw/300010.parquet","publicationDate":"2026-04-30","schema":"audited-parquet-alias/v1","scope":"identity-only; original prices/names/universe and historical ST intervals unchanged","sourceName":"豆神教育","statedEffectiveDate":"2026-05-06","type":"stock","universeSha256":"4e6743c66af9d784a0e69c21571b2d729ee7f63b8c1b5105a07d3247b3bca714"}',
    '{"artifactSha256":"a70ab53a6fb2615529cb7ff299e348c9d0ac55e8278c16bc4e168ae9d7329aee","code":"000010","contentSha256":"0db3f284948b670cf1d1178c0ee84ad62e73aed4f6301e04fb703d4cf32e8038","directoryName":"*ST美丽","group":"datasets/sina-a-share-20200101-20260807","legacyKey":"stock_search_index:6","manifestSha256":"456fcf07b401a709bef4ddd090f45109f4da2a5e43acbcb3374f29fcdb2815fc","market":"SZ","nativeId":"SZ:stock:000010","noticeSha256":"12ab155026c70a73a940fd3effb744db087181c1891c624309ab38537fa432e1","noticeUrl":"https://static.cninfo.com.cn/finalpage/2026-04-29/1225251716.PDF","path":"datasets/sina-a-share-20200101-20260807/raw/000010.parquet","publicationDate":"2026-04-29","schema":"audited-parquet-alias/v1","scope":"identity-only; original prices/names/universe and historical ST intervals unchanged","sourceName":"美丽生态","statedEffectiveDate":"2026-04-30","type":"stock","universeSha256":"f474cad904a6b9cd3a7eef9b5af005e3604e27813550be981c81bda10c3b2abf"}',
    '{"artifactSha256":"6672a9cda643039701c27427c2cdea864c4ba9b9d2e3a17fc39a86993fc530a8","code":"000016","contentSha256":"f2fe3aaf86aef1219878dc3f7d959e1e852e7812cc64ab26c5467570ff41c587","directoryName":"*ST康佳A","group":"datasets/sina-a-share-20200101-20260807","legacyKey":"stock_search_index:26","manifestSha256":"456fcf07b401a709bef4ddd090f45109f4da2a5e43acbcb3374f29fcdb2815fc","market":"SZ","nativeId":"SZ:stock:000016","noticeSha256":"666689e0a11d942153cdbfbad515ea6d91d31fe01c1f88c9bfb751f235637df1","noticeUrl":"https://disc.static.szse.cn/disc/disk03/finalpage/2026-04-29/33994a43-0f3a-4776-8857-ed8163a15ce6.PDF","path":"datasets/sina-a-share-20200101-20260807/raw/000016.parquet","publicationDate":"2026-04-29","schema":"audited-parquet-alias/v1","scope":"identity-only; original prices/names/universe and historical ST intervals unchanged","sourceName":"深康佳Ａ","statedEffectiveDate":"2026-04-30","type":"stock","universeSha256":"f474cad904a6b9cd3a7eef9b5af005e3604e27813550be981c81bda10c3b2abf"}',
    '{"artifactSha256":"137e28d2e6f741ae087e6494c715aae363468e332012275475574d140ec4115d","code":"000639","contentSha256":"1a4c8c96466a72bc4dc3f979591e014a202cc68d68e9a5054b201bb6017fc087","directoryName":"ST西王","group":"datasets/sina-a-share-20200101-20260807","legacyKey":"stock_search_index:201","manifestSha256":"456fcf07b401a709bef4ddd090f45109f4da2a5e43acbcb3374f29fcdb2815fc","market":"SZ","nativeId":"SZ:stock:000639","noticeSha256":"258fa47aa3e0cb80541cb5360c3e6758a4ae1c6d3acd3b5f4ab16d18930fa7ea","noticeUrl":"https://disc.static.szse.cn/disc/disk03/finalpage/2026-04-29/5dbc18ae-870e-4ceb-8149-299b34752f1d.PDF","path":"datasets/sina-a-share-20200101-20260807/raw/000639.parquet","publicationDate":"2026-04-29","schema":"audited-parquet-alias/v1","scope":"identity-only; original prices/names/universe and historical ST intervals unchanged","sourceName":"西王食品","statedEffectiveDate":"2026-04-30","type":"stock","universeSha256":"f474cad904a6b9cd3a7eef9b5af005e3604e27813550be981c81bda10c3b2abf"}',
    '{"artifactSha256":"6ccac0ad7a1e1077fe52b6d72f0b745d409fde361df4bdf3c6ccf32503c57ed5","code":"000672","contentSha256":"c4656e1fdb2bb3cf15e08e182aaa074fefa393c269a9d1704b96d88ff4c1bb41","directoryName":"上峰材料","group":"datasets/sina-a-share-20200101-20260807","legacyKey":"stock_search_index:206","manifestSha256":"456fcf07b401a709bef4ddd090f45109f4da2a5e43acbcb3374f29fcdb2815fc","market":"SZ","nativeId":"SZ:stock:000672","noticeSha256":"d4bb8976647b38834d91c8e9088d8345a7149e29505348fc69022693385bb5c8","noticeUrl":"https://disc.static.szse.cn/disc/disk03/finalpage/2026-08-24/a12ae83b-2f18-47b0-8c79-a434aec51701.PDF","path":"datasets/sina-a-share-20200101-20260807/raw/000672.parquet","publicationDate":"2026-08-24","schema":"audited-parquet-alias/v1","scope":"identity-only; original prices/names/universe and historical ST intervals unchanged","sourceName":"上峰水泥","statedEffectiveDate":null,"type":"stock","universeSha256":"f474cad904a6b9cd3a7eef9b5af005e3604e27813550be981c81bda10c3b2abf"}',
    '{"artifactSha256":"e0573b3faeea1ce93b48fbfc7c278286a59fc60c1d8a6295d49a81af832fc625","code":"002082","contentSha256":"ba87912a7f91ce4923c49b415c52ba3ad2dd5054a1715bd7cc08cb29ae3db69b","directoryName":"ST万邦","group":"datasets/sina-a-share-20200101-20260807","legacyKey":"stock_search_index:78","manifestSha256":"456fcf07b401a709bef4ddd090f45109f4da2a5e43acbcb3374f29fcdb2815fc","market":"SZ","nativeId":"SZ:stock:002082","noticeSha256":"a04d72cc9e7cf49b4a780dc99d84d6f9f7b68e5b1cc579feea5cb0d8ce5fac09","noticeUrl":"https://static.cninfo.com.cn/finalpage/2026-04-30/1225268899.PDF","path":"datasets/sina-a-share-20200101-20260807/raw/002082.parquet","publicationDate":"2026-04-30","schema":"audited-parquet-alias/v1","scope":"identity-only; original prices/names/universe and historical ST intervals unchanged","sourceName":"万邦德","statedEffectiveDate":"2026-05-06","type":"stock","universeSha256":"f474cad904a6b9cd3a7eef9b5af005e3604e27813550be981c81bda10c3b2abf"}',
    '{"artifactSha256":"e68a560d3784f51c3a0444c642db1ad2b2043d378dfe5bd8d5cd7e429d3d36fc","code":"002694","contentSha256":"c76f2d4373e717fc38575aa7e901c3ca1962c611860c198be7f1b93ed8c0ac94","directoryName":"*ST顾地","group":"datasets/sina-a-share-20200101-20260807","legacyKey":"stock_search_index:95","manifestSha256":"456fcf07b401a709bef4ddd090f45109f4da2a5e43acbcb3374f29fcdb2815fc","market":"SZ","nativeId":"SZ:stock:002694","noticeSha256":"2054d800e3d4b77f1381400fd2f3e92bfd88d325179f267f8fdddde230d99e5a","noticeUrl":"https://disc.static.szse.cn/download/disc/disk03/finalpage/2026-04-29/10d8c553-15c4-4167-9a61-94a46483db6e.PDF","path":"datasets/sina-a-share-20200101-20260807/raw/002694.parquet","publicationDate":"2026-04-29","schema":"audited-parquet-alias/v1","scope":"identity-only; original prices/names/universe and historical ST intervals unchanged","sourceName":"顾地科技","statedEffectiveDate":"2026-04-30","type":"stock","universeSha256":"f474cad904a6b9cd3a7eef9b5af005e3604e27813550be981c81bda10c3b2abf"}',
    '{"artifactSha256":"34744ab90be5cb3fa89821df5e1b0e5b70ea453a3166a139f344f14e9cfde28a","code":"300010","contentSha256":"6a6e53d58936c1570035dcfc26e3a6d54dc44c697f640edc065a06c73c2636c5","directoryName":"ST豆神","group":"datasets/sina-a-share-20200101-20260807","legacyKey":"stock_search_index:196","manifestSha256":"456fcf07b401a709bef4ddd090f45109f4da2a5e43acbcb3374f29fcdb2815fc","market":"SZ","nativeId":"SZ:stock:300010","noticeSha256":"d38030809702101939401066c6dac2a87192e08b1a46767b15b813cda2634674","noticeUrl":"https://static.cninfo.com.cn/finalpage/2026-04-30/1225269274.PDF","path":"datasets/sina-a-share-20200101-20260807/raw/300010.parquet","publicationDate":"2026-04-30","schema":"audited-parquet-alias/v1","scope":"identity-only; original prices/names/universe and historical ST intervals unchanged","sourceName":"豆神教育","statedEffectiveDate":"2026-05-06","type":"stock","universeSha256":"f474cad904a6b9cd3a7eef9b5af005e3604e27813550be981c81bda10c3b2abf"}',
)
PRICE_COLUMNS = ['date', 'code', 'name', 'open', 'high', 'low', 'close', 'volume']


def need(ok, message):
    if not ok:
        raise ValueError(message)


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def file_sha(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def safe_path(root, relative):
    need(isinstance(relative, str) and relative and not PureWindowsPath(relative).is_absolute(), 'absolute/empty artifact path')
    target = (root / relative).resolve()
    need(target.is_relative_to(root.resolve()) and target != root.resolve(), 'artifact escapes source root')
    return target


def object_file(path):
    raw = path.read_bytes()
    need(len(raw) <= 64 * 1024 * 1024, 'metadata exceeds 64MiB')
    obj = json.loads(raw.decode('utf-8-sig'))
    need(isinstance(obj, dict), 'metadata must be an object')
    return obj, raw


def save(path, obj):
    raw = encoded(obj) + b'\n'
    if path.exists() and path.read_bytes() == raw:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp-' + str(os.getpid()))
    try:
        with temporary.open('xb') as f:
            f.write(raw)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return True


def canonical_manifest(obj):
    return sha(encoded({k: v for k, v in obj.items() if k != 'manifestSha256'}))


def identities(path):
    result = collections.defaultdict(list)
    with sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True) as c:
        c.execute('PRAGMA query_only=ON')
        for key, full_id, can_open, raw, expected, evidence in c.execute(
                'SELECT legacy_key,native_id,can_open,content_json,content_sha256,evidence_json FROM directory_rows'):
            need(sha(raw.encode('utf-8')) == expected, 'identity content hash mismatch')
            obj = json.loads(raw)
            ev = json.loads(evidence)
            if (can_open and obj.get('canOpen') and obj.get('type') in ['stock', 'etf']
                    and obj.get('id') == full_id and obj.get('market') in ['SH', 'SZ', 'BJ']
                    and full_id == obj['market'] + ':' + obj['type'] + ':' + obj['code']
                    and not ev.get('conflict')):
                result[(obj['code'], obj['name'])].append(dict(
                    id=full_id, market=obj['market'], type=obj['type'], name=obj['name'],
                    legacyKey=key, contentSha256=expected, contentUtf8=raw, evidence=ev))
    return result


def latin_width(name):
    # Only Latin letter width changes. Never strip ST, whitespace, punctuation,
    # case, or other characters to infer a renamed/ambiguous security.
    return ''.join(chr(ord(c) - 0xfee0) if 'Ａ' <= c <= 'Ｚ' or 'ａ' <= c <= 'ｚ' else c for c in name)


def identity_matches(index, code, name):
    found = [x for (c, n), rows in index.items() if c == code and latin_width(n) == latin_width(name) for x in rows]
    return [dict(x, name=name, directoryName=x['name'],
                 bindingKind='exact' if x['name'] == name else 'fullwidth-latin') for x in found]


def bind_identity(index, code, name):
    found = identity_matches(index, code, name)
    return {k: v for k, v in found[0].items() if k != 'contentUtf8'} if len(found) == 1 else dict(
        id=None, market=None, type='stock-unconfirmed', name=name,
        reason='no unique typed directory identity with exact name or Latin-width-only equivalence')


def source_identity_matches(index, entry, group):
    exact = identity_matches(index, entry['code'], entry['name'])
    if exact:
        return exact
    if entry.get('kind') != 'prices' or group.get('kind') != 'prices':
        return []
    result = []
    for raw in AUDITED_ALIAS_TEXTS:
        proof = json.loads(raw)
        if not (proof['path'] == entry['path'] and proof['group'] == entry['group'] == group['id']
                and proof['code'] == entry['code'] and proof['sourceName'] == entry['name']
                and proof['artifactSha256'] == entry['sha256'] and proof['manifestSha256'] == group['metadataSha256']):
            continue
        for row in index.get((entry['code'], proof['directoryName']), []):
            if (row['id'] == proof['nativeId'] and row['market'] == proof['market'] and row['type'] == proof['type']
                    and row['contentSha256'] == proof['contentSha256'] and row['legacyKey'] == proof['legacyKey']):
                result.append(dict(row, name=entry['name'], directoryName=row['name'],
                                   bindingKind='audited-source-alias', aliasUtf8=raw))
    return result


def day(value):
    text = value.isoformat() if hasattr(value, 'isoformat') else str(value)
    parsed = dt.date.fromisoformat(text[:10])
    need(text[:10] == parsed.isoformat(), 'invalid ISO date')
    return parsed.isoformat()


def price_table(path, spec=None):
    table = pq.read_table(path, columns=PRICE_COLUMNS)
    need(table.num_rows > 0, 'empty price artifact')
    need(all(table[c].null_count == 0 for c in PRICE_COLUMNS), 'null price/identity/date/volume')
    codes, names = pc.unique(table['code']).to_pylist(), pc.unique(table['name']).to_pylist()
    need(len(codes) == len(names) == 1 and isinstance(codes[0], str) and len(codes[0]) == 6
         and codes[0].isdigit() and names[0], 'price identity is not one embedded six digit code/name')
    dates = [day(x) for x in table['date'].to_pylist()]
    need(len(set(dates)) == len(dates), 'duplicate code/date')
    for column in PRICE_COLUMNS[3:]:
        values = pc.cast(table[column], pa.float64())
        need(bool(pc.all(pc.is_finite(values)).as_py()), 'nonfinite ' + column)
        need(bool(pc.all(pc.greater_equal(values, 0) if column == 'volume' else pc.greater(values, 0)).as_py()), 'invalid ' + column)
    for a, b in [('high', 'open'), ('high', 'close'), ('high', 'low'), ('open', 'low'), ('close', 'low')]:
        need(bool(pc.all(pc.greater_equal(table[a], table[b])).as_py()), 'invalid OHLC bounds')
    if spec:
        need(codes[0] == spec.get('code') and names[0] == spec.get('name')
             and table.num_rows == spec.get('rows') and min(dates) == spec.get('start')
             and max(dates) == spec.get('end'), 'decoded prices do not match manifest identity/coverage')
    return table, dict(code=codes[0], name=names[0], start=min(dates), end=max(dates))


def inventory(root, identity_db):
    root = root.resolve()
    identity_db = identity_db.resolve()
    identity_sha = file_sha(identity_db)
    index = identities(identity_db)
    groups, entries = {}, []
    for folder, kind, metadata in [('datasets', 'prices', 'manifest.json'), ('runs', 'predictions', 'result.json'),
                                   ('factor-runs', 'factors', 'result.json'), ('recovery', 'recovery', 'collection-state.json')]:
        for path in sorted((root / folder).glob('*/' + metadata)):
            original, raw = object_file(path)
            group = path.parent.relative_to(root).as_posix()
            g = dict(id=group, kind=kind, metadataPath=path.relative_to(root).as_posix(), metadataSha256=sha(raw),
                     original=original, asOf=original.get('asOf'), adjustmentMode=original.get('adjustmentMode'),
                     period='day' if kind in ['prices', 'recovery'] else None,
                     status='incomplete-recovery' if kind == 'recovery' else 'unverified')
            if kind == 'prices':
                g['canonicalManifestSha256'] = canonical_manifest(original)
                need(original.get('schema') == 'webstock.quant.dataset.v1'
                     and original.get('manifestSha256') == g['canonicalManifestSha256'], 'dataset canonical manifest hash mismatch: ' + group)
                for artifact in original['files']:
                    if not artifact['path'].endswith('.parquet'):
                        p = safe_path(path.parent, artifact['path'])
                        need(file_sha(p) == artifact['sha256'], 'auxiliary manifest artifact hash mismatch')
            groups[group] = g
    known = set()
    for g in groups.values():
        parent = safe_path(root, g['id'])
        original = g['original']
        specs = {x['path']: x for x in original.get('files' if g['kind'] == 'prices' else 'artifacts', [])}
        paths = sorted(parent.rglob('*.parquet'))
        for p in paths:
            relative = p.relative_to(parent).as_posix()
            raw = p.read_bytes()
            entry = dict(path=p.relative_to(root).as_posix(), group=g['id'], kind=g['kind'], bytes=len(raw),
                         sha256=sha(raw), valid=False, issues=[], volumeUnit='original-unit-unverified')
            known.add(p.resolve())
            try:
                parquet = pq.ParquetFile(pa.BufferReader(raw))
                entry.update(rows=parquet.metadata.num_rows, columns=[dict(name=f.name, type=str(f.type)) for f in parquet.schema_arrow])
                spec = specs.get(relative)
                if g['kind'] != 'recovery':
                    need(spec is not None and entry['sha256'] == spec.get('sha256')
                         and entry['rows'] == spec.get('rows'), 'artifact manifest hash/rows mismatch')
                if g['kind'] in ['prices', 'recovery']:
                    _, details = price_table(pa.BufferReader(raw), spec if g['kind'] == 'prices' else None)
                    entry.update(details)
                    matches = source_identity_matches(index, entry, g)
                    entry['identity'] = {k: v for k, v in matches[0].items() if k != 'contentUtf8'} if len(matches) == 1 else bind_identity(index, entry['code'], entry['name'])
                    entry['sourceId'] = (spec or {}).get('sourceId', 'unrecorded')
                    if g['kind'] == 'prices':
                        need(entry['end'] <= g['asOf'], 'price after asOf')
                else:
                    required = ['date', 'code', 'score', 'label', 'fold'] + (['factorId'] if g['kind'] == 'factors' else [])
                    need(set(required).issubset(parquet.schema_arrow.names), 'score schema mismatch')
                    count = 0
                    for batch in parquet.iter_batches(columns=required):
                        count += batch.num_rows
                        for key in ['date', 'code', 'score', 'fold'] + (['factorId'] if g['kind'] == 'factors' else []):
                            need(batch.column(key).null_count == 0, 'null result identity/score/fold')
                        need(bool(pc.all(pc.is_finite(batch.column('score'))).as_py()), 'nonfinite score')
                        need(bool(pc.all(pc.match_substring_regex(batch.column('code'), r'^[0-9]{6}$')).as_py()), 'invalid embedded result code')
                    need(count == entry['rows'], 'footer/decoded score row mismatch')
                entry['valid'] = True
            except Exception as error:
                entry['issues'].append(str(error))
            entries.append(entry)
        if g['kind'] in ['predictions', 'factors']:
            link = original.get('dataManifest', {})
            candidates = [x for x in groups.values() if x['kind'] == 'prices' and x['original'].get('datasetId') == link.get('datasetId')]
            g['datasetGroup'] = candidates[0]['id'] if len(candidates) == 1 else None
            g['datasetLinkVerified'] = len(candidates) == 1 and candidates[0]['canonicalManifestSha256'] == link.get('sha256')
        own = [x for x in entries if x['group'] == g['id']]
        g['parquetCount'] = len(own)
        g['rowCount'] = sum(x.get('rows', 0) for x in own)
        if g['kind'] != 'recovery':
            g['status'] = 'verified-artifacts' if own and all(x['valid'] for x in own) else 'has-unverified-artifacts'
    for p in sorted(root.rglob('*.parquet')):
        if p.resolve() not in known:
            entries.append(dict(path=p.relative_to(root).as_posix(), kind='unknown', group=None, bytes=p.stat().st_size,
                                sha256=file_sha(p), valid=False, issues=['no recognized metadata owner']))
    training = []
    for g in groups.values():
        if g['kind'] in ['predictions', 'factors']:
            for a in g['original'].get('artifacts', []):
                if not a['path'].endswith('.parquet'):
                    p = safe_path(safe_path(root, g['id']), a['path'])
                    actual = file_sha(p) if p.is_file() else None
                    training.append(dict(group=g['id'], path=p.relative_to(root).as_posix(), kind='training-output-no-deserialization',
                                         bytes=p.stat().st_size if p.is_file() else None, sha256=actual,
                                         expectedSha256=a.get('sha256'), verified=actual == a.get('sha256')))
    counts = {}
    for kind in sorted(set(x['kind'] for x in entries)):
        own = [x for x in entries if x['kind'] == kind]
        counts[kind] = dict(files=len(own), bytes=sum(x['bytes'] for x in own), rows=sum(x.get('rows', 0) for x in own),
                            valid=sum(x['valid'] for x in own), unresolvedIdentity=sum('identity' in x and not x['identity']['id'] for x in own))
    # A changed source cannot yield an apparently stable full inventory. Decoding used
    # the exact bytes hashed above; this second pass also rejects replacement/addition.
    need({p.resolve() for p in root.rglob('*.parquet')} == {safe_path(root, x['path']) for x in entries}, 'Parquet membership changed during inventory')
    for entry in entries:
        need(file_sha(safe_path(root, entry['path'])) == entry['sha256'], 'artifact changed during inventory: ' + entry['path'])
    for g in groups.values():
        need(file_sha(safe_path(root, g['metadataPath'])) == g['metadataSha256'], 'metadata changed during inventory')
        for a in g['original'].get('files' if g['kind'] == 'prices' else 'artifacts', []):
            if not a['path'].endswith('.parquet'):
                p = safe_path(safe_path(root, g['id']), a['path'])
                need(file_sha(p) == a['sha256'], 'auxiliary/model artifact changed during inventory')
    need(file_sha(identity_db) == identity_sha, 'identity directory changed during inventory')
    return dict(schema=CATALOG, sourceRoot=str(root), identityDb=str(identity_db), identityDbSha256=identity_sha,
                counts=counts, groups=list(groups.values()), files=entries, trainingOutputs=training,
                limitations=['historical exploratory data; no training or task restoration',
                             'volume values retained in provider original units; units not verified',
                             'explicit stock/ETF directory identity; only exact name or Latin-width equivalence; original names preserved; unresolved is blocked',
                             'recovery is incomplete; scores and predictions are never candles'])


def verified_context(catalog_path, request):
    catalog, _ = object_file(catalog_path)
    need(catalog.get('schema') == CATALOG, 'unsupported catalog')
    root = Path(catalog['sourceRoot']).resolve()
    matches = [g for g in catalog['groups'] if g['id'] == request.get('group')]
    need(len(matches) == 1, 'select exactly one catalog group')
    group = matches[0]
    path = safe_path(root, group['metadataPath'])
    original, raw = object_file(path)
    need(sha(raw) == group['metadataSha256'] and original == group['original'], 'source metadata changed; rebuild inventory')
    return catalog, root, group, raw


def verified_artifact(root, entry, require_valid=True):
    path = safe_path(root, entry['path'])
    raw = path.read_bytes()
    need((entry['valid'] or not require_valid) and sha(raw) == entry['sha256'], 'source artifact changed/unverified; rebuild inventory')
    return path, raw


def clean_value(value):
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, (dt.datetime, dt.date)):
        return value.isoformat()
    return value


def query(catalog_path, request):
    catalog, root, group, manifest_raw = verified_context(catalog_path, request)
    need(request.get('action') in ['prices', 'scores', 'inspect'], 'unknown action')
    files = [x for x in catalog['files'] if x['group'] == group['id']]
    if request['action'] == 'inspect':
        need(group['kind'] in ['prices', 'recovery'], 'original row inspector is for price/recovery artifacts')
        selected = [x for x in files if x['path'] == request.get('file')]
        need(len(selected) == 1, 'select one exact catalog artifact for inspection')
        entry = selected[0]
        _, raw = verified_artifact(root, entry, require_valid=False)
        parquet = pq.ParquetFile(pa.BufferReader(raw))
        offset = request.get('offset', 0)
        need(isinstance(offset, int) and offset >= 0, 'invalid inspection offset')
        output, bad_rows, count = [], [], 0
        for batch in parquet.iter_batches():
            for original in batch.to_pylist():
                count += 1
                reasons = []
                def finite(k):
                    v = original.get(k)
                    return isinstance(v, (int, float)) and math.isfinite(v)
                for key in ['open', 'high', 'low', 'close', 'volume']:
                    if not finite(key) or (original[key] < 0 if key == 'volume' else original[key] <= 0):
                        reasons.append('invalid ' + key)
                if all(finite(k) for k in ['open', 'high', 'low', 'close']):
                    if not (original['low'] <= min(original['open'], original['close']) <= max(original['open'], original['close']) <= original['high']):
                        reasons.append('invalid OHLC bounds')
                if reasons:
                    bad_rows.append(dict(sourceRow1Based=count, reasons=reasons))
                if offset < count <= offset + 500:
                    row = {k: clean_value(v) for k, v in original.items()}
                    row['sourceRow1Based'] = count
                    row['rowIssues'] = '; '.join(reasons)
                    row['nonfiniteOriginalValues'] = '; '.join(k + '=' + repr(v) for k, v in original.items() if isinstance(v, float) and not math.isfinite(v))
                    output.append(row)
        return dict(schema='quant-parquet-response/v1', kind='inspection', group=group['id'], file=entry['path'],
                    total=count, offset=offset, rows=output,
                    columns=['sourceRow1Based'] + parquet.schema_arrow.names + ['rowIssues', 'nonfiniteOriginalValues'],
                    sourceFileSha256=entry['sha256'], original=group['original'], asOf=group['asOf'],
                    artifactIssues=entry['issues'], invalidRowCount=len(bad_rows), invalidRows=bad_rows[:500],
                    invalidRowPositionsTruncated=len(bad_rows)>500, usableAsBusinessInput=False,
                    limitations=['original row inspection only; no price repair, Quant import, chart or training'])
    start, end = day(request.get('start')), day(request.get('end'))
    need(start <= end, 'start after end')
    if request['action'] == 'prices':
        need(group['kind'] == 'prices', 'only verified price artifacts can be Quant/chart input')
        codes = request.get('codes')
        need(isinstance(codes, list) and 1 <= len(codes) <= 1200 and len(codes) == len(set(codes)), 'explicit unique selection of 1..1200 codes required')
        selected = [x for x in files if x.get('code') in codes]
        need(len(selected) == len(codes) and all(x.get('identity', {}).get('id') for x in selected), 'unknown/ambiguous security identity')
        identity_db = Path(catalog['identityDb'])
        need(file_sha(identity_db) == catalog['identityDbSha256'], 'identity directory changed; rebuild inventory')
        current_identities = identities(identity_db)
        bars, artifacts, bindings = [], [], []
        for entry in sorted(selected, key=lambda x: x['code']):
            path, raw = verified_artifact(root, entry)
            specs = [x for x in group['original']['files'] if x.get('code') == entry['code'] and x['path'].endswith('.parquet')]
            need(len(specs) == 1, 'manifest code ambiguity')
            table, _ = price_table(pa.BufferReader(raw), specs[0])
            rows = table.to_pylist()
            rows = sorted((r for r in rows if start <= day(r['date']) <= end), key=lambda r: day(r['date']))
            need(rows, 'selected security has no rows in date scope: ' + entry['code'])
            for r in rows:
                r['date'] = day(r['date'])
            bars.extend(rows)
            need(len(bars) <= 100000, 'Quant supports at most 100000 rows; select a smaller explicit date/security scope')
            artifacts.append(dict(path=specs[0]['path'], sha256=entry['sha256'], rows=entry['rows'], code=entry['code'],
                                  bytesBase64=base64.b64encode(raw).decode('ascii')))
            matches = [x for x in source_identity_matches(current_identities, entry, group)
                       if x['id'] == entry['identity']['id'] and x['contentSha256'] == entry['identity']['contentSha256']]
            need(len(matches) == 1, 'identity evidence changed')
            bindings.append(dict(code=entry['code'], **matches[0]))
        need(file_sha(identity_db) == catalog['identityDbSha256'], 'identity directory changed during selection')
        scope = dict(action='prices', group=group['id'], codes=sorted(codes), start=start, end=end)
        bars_raw = encoded(bars)
        evidence = dict(schema='quant-parquet-selection-evidence/v1', selection=scope,
                        manifestUtf8=manifest_raw.decode('utf-8'), manifestFileSha256=sha(manifest_raw),
                        artifacts=artifacts, barsUtf8=bars_raw.decode('utf-8'), barsSha256=sha(bars_raw),
                        identityDbSha256=catalog['identityDbSha256'], identities=bindings,
                        conversion='explicit-offline-parquet-selection-to-bars', nativeLimitation='explicit selection, not the whole legacy dataset; raw volume unit unverified; exploratory only')
        source = group['original']
        dataset = dict(schema='quant-native-dataset/v1', datasetId=source['datasetId'] + ':selection:' + sha(encoded(scope))[:16],
                       sourceDatasetId=source['datasetId'], source=encoded(source['source']).decode('utf-8'),
                       adjustmentMode=source['adjustmentMode'], membershipMode=source['universe']['membershipMode'],
                       asOf=source['asOf'], period='day', volumeUnit='original-unit-unverified',
                       bars=bars, parquetSelectionEvidence=evidence)
        need(len(encoded(dataset)) <= 32 * 1024 * 1024, 'selected package exceeds native 32MiB limit')
        chart = None
        if len(bindings) == 1:
            identity = bindings[0]
            chart = dict(schema='quant-parquet-chart/v1', id=identity['id'], name=identity['name'], code=identity['code'], market=identity['market'],
                         dataset=dataset, period='day', asOf=dataset['asOf'], adjustmentMode=dataset['adjustmentMode'],
                         volumeUnit=dataset['volumeUnit'], rows=bars)
        # Keep one copy of the large evidence; the native UI constructs chart.dataset from dataset on demand.
        if chart:
            chart.pop('dataset')
        return dict(schema='quant-parquet-response/v1', kind='prices', dataset=dataset, chart=chart, total=len(bars),
                    rows=bars[:500], columns=PRICE_COLUMNS, limitations=catalog['limitations'])
    need(group['kind'] in ['predictions', 'factors'] and group['datasetLinkVerified'], 'score/result requires a verified source dataset link')
    need(len(files) == 1, 'one result Parquet expected')
    path, raw = verified_artifact(root, files[0])
    code = request.get('code', '')
    factor = request.get('factorId', '')
    fold = request.get('fold', '')
    offset = request.get('offset', 0)
    need(isinstance(offset, int) and offset >= 0, 'invalid page offset')
    dataset_group = next(g for g in catalog['groups'] if g['id'] == group['datasetGroup'])
    linked_path = safe_path(root, dataset_group['metadataPath'])
    need(file_sha(linked_path) == dataset_group['metadataSha256'], 'linked source dataset metadata changed')
    source_files = {f.get('code'): f for f in catalog['files'] if f['group'] == group['datasetGroup'] and f.get('code')}
    source_specs = {f['code']: f for f in dataset_group['original']['files'] if f.get('code')}
    output, count = [], 0
    parquet = pq.ParquetFile(pa.BufferReader(raw))
    for batch in parquet.iter_batches():
        table = pa.Table.from_batches([batch])
        dates = pc.cast(table['date'], pa.date32())
        mask = pc.and_(pc.greater_equal(dates, pa.scalar(dt.date.fromisoformat(start))), pc.less_equal(dates, pa.scalar(dt.date.fromisoformat(end))))
        if code:
            mask = pc.and_(mask, pc.equal(table['code'], code))
        if factor:
            need('factorId' in table.column_names, 'factor filter only applies to factor results')
            mask = pc.and_(mask, pc.equal(table['factorId'], factor))
        if fold != '':
            mask = pc.and_(mask, pc.equal(table['fold'], int(fold)))
        filtered = table.filter(mask)
        begin, finish = max(0, offset - count), min(filtered.num_rows, offset + 500 - count)
        if finish > begin:
            for row in filtered.slice(begin, finish - begin).to_pylist():
                original_label = row['label']
                row = {k: clean_value(v) for k, v in row.items()}
                spec = source_specs.get(row['code'], {})
                identity = source_files.get(row['code'], {}).get('identity', {})
                row['sourceName'] = spec.get('name')
                row['market'] = identity.get('market')
                row['instrumentId'] = identity.get('id')
                row['identityState'] = identity.get('bindingKind', 'exact-code-name-directory') if identity.get('id') else 'unresolved'
                row['labelState'] = 'missing-null' if original_label is None else 'original-nonfinite' if isinstance(original_label, float) and not math.isfinite(original_label) else 'original-value'
                output.append(row)
        count += filtered.num_rows
    return dict(schema='quant-parquet-response/v1', kind=group['kind'], group=group['id'], asOf=group['asOf'],
                total=count, offset=offset, rows=output,
                columns=parquet.schema_arrow.names + ['sourceName', 'market', 'instrumentId', 'identityState', 'labelState'],
                original=group['original'], sourceDataPeriod='day', sourceDataAdjustmentMode=dataset_group['adjustmentMode'],
                sourceDataAsOf=dataset_group['asOf'],
                artifactSha256=files[0]['sha256'], labelNullMeaning='original missing/NaN; never zero-filled',
                limitations=catalog['limitations'])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-root', type=Path)
    parser.add_argument('--identity-db', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--catalog', type=Path)
    args = parser.parse_args()
    if args.catalog:
        raw = sys.stdin.buffer.read(1024 * 1024 + 1)
        need(len(raw) <= 1024 * 1024, 'request exceeds 1MiB')
        result = query(args.catalog, json.loads(raw.decode('utf-8')))
        out = encoded(result)
        need(len(out) <= 32 * 1024 * 1024, 'response exceeds 32MiB; narrow selection')
        sys.stdout.buffer.write(out)
    else:
        need(args.source_root and args.identity_db and args.output, 'inventory requires source-root, identity-db and output')
        need(not args.output.resolve().is_relative_to(args.source_root.resolve()), 'inventory output must be outside original source')
        result = inventory(args.source_root, args.identity_db)
        save(args.output, result)
        print(json.dumps(dict(counts=result['counts'], groups=len(result['groups']), trainingOutputs=len(result['trainingOutputs'])), ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
