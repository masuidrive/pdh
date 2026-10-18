#!/usr/bin/env python3
"""完成した板の本文と画像を保ち、data URI だけを別ファイルへ取り出す。"""
import argparse
import base64
import binascii
import hashlib
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
import re
from urllib.parse import unquote_to_bytes


ATTRIBUTE = re.compile(r'''([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?''')
EXTENSIONS = {'png': 'png', 'jpeg': 'jpg', 'gif': 'gif', 'webp': 'webp', 'svg+xml': 'svg'}


class ImageSources(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=False)
        self.starts = [0] + [m.end() for m in re.finditer('\n', source)]
        self.sources = []

    def handle_starttag(self, tag, attrs):
        if tag != 'img':
            return
        raw = self.get_starttag_text()
        line, column = self.getpos()
        offset = self.starts[line - 1] + column
        for match in ATTRIBUTE.finditer(raw, len('<img')):
            if match[1].lower() != 'src':
                continue
            for group in (2, 3, 4):
                if match[group] is not None:
                    start, end = match.span(group)
                    self.sources.append((offset + start, offset + end, unescape(match[group])))
                    break

    handle_startendtag = handle_starttag


def review_copy(source: str, output: Path) -> int:
    assets = {}
    asset_dir = output.with_suffix('.assets')

    parser = ImageSources(source)
    parser.feed(source)
    parser.close()
    replacements = []
    for start, end, uri in parser.sources:
        if not uri.lower().startswith('data:image/'):
            continue
        header, separator, payload = uri.partition(',')
        if not separator:
            raise ValueError('image data URI must contain a comma between header and payload')
        mime, *parameters = header[len('data:image/'):].lower().split(';')
        if mime not in EXTENSIONS:
            raise ValueError(f'unsupported image type: {mime}')
        data = unquote_to_bytes(payload)
        if 'base64' in parameters:
            data = base64.b64decode(data, validate=True)
        name = hashlib.sha256(data).hexdigest() + '.' + EXTENSIONS[mime]
        assets[name] = data
        replacements.append((start, end, asset_dir.name + '/' + name))

    copied = source
    for start, end, path in reversed(replacements):
        copied = copied[:start] + path + copied[end:]
    output.parent.mkdir(parents=True, exist_ok=True)
    if assets:
        asset_dir.mkdir(exist_ok=True)
        for name, data in assets.items():
            (asset_dir / name).write_bytes(data)
    output.write_text(copied, encoding='utf-8')
    return len(assets)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    if args.input.resolve() == args.out.resolve():
        parser.error('--out must differ from --input')
    try:
        count = review_copy(args.input.read_text(encoding='utf-8'), args.out)
        remaining = len(re.findall(r'\bdata:[a-z0-9.+-]+/[a-z0-9.+-]+[;,]', args.out.read_text(encoding='utf-8'), re.IGNORECASE))
    except (OSError, ValueError, binascii.Error) as error:
        parser.exit(1, f'review-copy: {error}\n')
    print(f'review-copy: {count} images extracted; {remaining} data URIs remaining; {args.out}')


if __name__ == '__main__':
    main()
