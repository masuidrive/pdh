#!/usr/bin/env python3
"""review-copy.py の本文・画像保持と不正な data URI の拒否を確かめる。"""
import base64
from pathlib import Path
import subprocess
import tempfile
import unittest
from urllib.parse import quote

TOOL = Path(__file__).with_name('review-copy.py')
class ReviewCopyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def copy(self, board, code=0):
        source = self.root / 'source.html'
        output = self.root / 'review/board.html'
        source.write_text(board)
        result = subprocess.run(['python3', str(TOOL), '--input', str(source), '--out', str(output)], text=True, capture_output=True)
        self.assertEqual(result.returncode, code, result.stdout + result.stderr)
        self.assertEqual(source.read_text(), board)
        return output

    def test_quote_aware_attributes_preserve_large_images_and_markup(self):
        payload = b'large-image' * 100000
        uri = 'data:image/png;base64,' + base64.b64encode(payload).decode()
        for tag in (
            '<img alt="before > after" src="URI">',
            "<IMG alt='before > after' SRC='URI'/>",
            '<img data-src="untouched" alt="src=other > next" src="URI">',
            '<img\nalt="before > after"\nsrc=URI>',
            '<img title="before &gt; after" src="URI">',
        ):
            with self.subTest(tag=tag):
                board = '<html><style>.board {color:red}</style>\n<main><h1>判断</h1>' + tag.replace('URI', uri) + '<img src="' + uri + '"><p>本文</p></main><script>answer()</script></html>'
                output = self.copy(board)
                copied = output.read_text()
                self.assertLess(len(copied), 1000)
                assets = list(output.with_suffix('.assets').glob('*'))
                self.assertEqual(len(assets), 1)
                self.assertEqual(assets[0].read_bytes(), payload)
                self.assertEqual(copied.replace('board.assets/' + assets[0].name, uri), board)

    def test_plain_html_and_relative_images_are_preserved(self):
        for board in ('<main><p>画像なし</p></main>', '<img src="existing.png" alt="before > after">'):
            with self.subTest(board=board):
                self.assertEqual(self.copy(board).read_text(), board)

    def test_invalid_or_unsupported_image_is_rejected_without_output(self):
        for uri in ('data:image/png;base64,!!!', 'data:image/unknown;base64,eA=='):
            with self.subTest(uri=uri):
                output = self.copy('<img alt="x > y" src="' + uri + '">', code=1)
                self.assertFalse(output.exists())

    def test_percent_encoded_svg_is_extracted(self):
        svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>図+</text></svg>'.encode()
        for parameters in ('', ';charset=utf-8'):
            with self.subTest(parameters=parameters):
                uri = 'data:image/svg+xml' + parameters + ',' + quote(svg)
                output = self.copy('<img src="' + uri + '">')
                asset = next(output.with_suffix('.assets').glob('*.svg'))
                self.assertEqual(asset.read_bytes(), svg)
                self.assertNotIn('data:image/', output.read_text())

    def test_data_uris_outside_img_src_are_preserved(self):
        for board in (
            '<style>.icon {background:url(data:image/svg+xml,%3Csvg%3E);}</style>',
            '<script>const sample = "data:image/png;base64,eA==";</script>',
            '<div data-src="data:image/png;base64,eA==">本文</div>',
        ):
            with self.subTest(board=board):
                self.assertEqual(self.copy(board).read_text(), board)
                output = self.copy(board + '<img src="data:image/png;base64,eA==">')
                self.assertTrue(output.read_text().startswith(board))

    def test_missing_data_uri_separator_has_actionable_error(self):
        self.copy('<img src="data:image/svg+xml">', code=1)
        result = subprocess.run(['python3', str(TOOL), '--input', str(self.root / 'source.html'),
                                 '--out', str(self.root / 'bad.html')], text=True, capture_output=True)
        self.assertIn('image data URI must contain a comma', result.stderr)
        self.assertNotIn('not enough values to unpack', result.stderr)


class RemainingDataUriTests(unittest.TestCase):
    def test_summary_counts_remaining_data_uris_without_rejecting_copy(self):
        image = '<img src="data:image/png;base64,eA==">'
        preserved = ('<style>.icon {background:url(data:image/svg+xml,%3Csvg%3E);}</style>'
                     '<script>const sample = "DATA:image/png;base64,eA==";</script>'
                     '<div data-src="data:image/png;base64,eA==">本文</div>'
                     '<a href="data:text/plain,hello">資料</a>')
        for board, extracted, remaining in (
            ('<p>metadata: 本文</p>', 0, 0),
            ('<p>入力 data: 3 件</p>', 0, 0),
            ('<p>入力 data: 3 件</p><pre>curl -d data:x</pre>', 0, 0),
            ('<p>data:text/plain data:/plain, data:text/,</p>', 0, 0),
            ('<a href="data:application/vnd.api+json,%7B%7D">JSON</a>', 0, 1),
            ('<a href="data:text/plain;charset=utf-8,hello">資料</a>', 0, 1),
            (image, 1, 0),
            (preserved, 0, 4),
            (preserved + image, 1, 4),
        ):
            with self.subTest(board=board, extracted=extracted, remaining=remaining):
                with tempfile.TemporaryDirectory() as tmp:
                    source, output = Path(tmp) / 'source.html', Path(tmp) / 'review.html'
                    source.write_text(board, encoding='utf-8')
                    result = subprocess.run(['python3', str(TOOL), '--input', str(source), '--out', str(output)],
                                            text=True, capture_output=True)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertIn(f'{extracted} images extracted; {remaining} data URIs remaining;', result.stdout)
                    self.assertEqual(source.read_text(encoding='utf-8'), board)
                    if not extracted:
                        self.assertEqual(output.read_text(encoding='utf-8'), board)
                    if board.startswith(preserved):
                        self.assertTrue(output.read_text(encoding='utf-8').startswith(preserved))


if __name__ == '__main__':
    unittest.main()
