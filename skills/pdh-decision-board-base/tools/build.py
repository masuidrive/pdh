#!/usr/bin/env python3
"""Assemble a decision-board body fragment into one self-contained HTML file."""

from __future__ import annotations

import argparse
import base64
import html
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlsplit


DEFAULTS = {
    "lang": "ja",
    "layout": "document",
    "title": None,
    "assets_dir": None,
    "mermaid": False,
    "kit_dir": None,
}

MIME_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
}

PROHIBITED_PUNCTUATION = "、。）」』】：；！？・"
WORD_JOINER = "\u2060"
EXCLUDED_TEXT_ANCESTORS = {"pre", "code", "script", "style", "textarea"}
INLINE_TAGS = {
    "a", "abbr", "b", "bdi", "bdo", "cite", "code", "del", "dfn", "em",
    "i", "ins", "kbd", "mark", "q", "ruby", "s", "samp", "small", "span",
    "strong", "sub", "sup", "time", "u", "var",
}
VOID_TAGS = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}


class BuildError(RuntimeError):
    pass


class FirstH1Parser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.in_h1 = False
        self.done = False
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() == "h1" and not self.done:
            self.in_h1 = True

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "h1" and self.in_h1:
            self.in_h1 = False
            self.done = True

    def handle_data(self, data: str) -> None:
        if self.in_h1:
            self.parts.append(data)

    def handle_entityref(self, name: str) -> None:
        if self.in_h1:
            self.parts.append(html.unescape(f"&{name};"))

    def handle_charref(self, name: str) -> None:
        if self.in_h1:
            self.parts.append(html.unescape(f"&#{name};"))

    @property
    def title(self) -> str | None:
        value = re.sub(r"\s+", " ", "".join(self.parts)).strip()
        return value or None


class BodyTransformer(HTMLParser):
    """Preserve source markup except img tags, and change only eligible text nodes."""

    def __init__(self, assets_dir: Path, japanese: bool) -> None:
        super().__init__(convert_charrefs=False)
        self.assets_dir = assets_dir
        self.japanese = japanese
        self.parts: list[str] = []
        self.stack: list[str] = []
        self.pending_inline_close = False
        self.pending_ascii = False
        self.embedded: list[str] = []

    def _excluded(self) -> bool:
        return any(tag in EXCLUDED_TEXT_ANCESTORS for tag in self.stack)

    def _relative_image_path(self, value: str) -> tuple[Path, str] | None:
        parsed = urlsplit(value)
        if parsed.scheme or parsed.netloc or value.startswith(("/", "#", "?", "data:")):
            return None
        suffix = Path(unquote(parsed.path)).suffix.lower()
        if suffix not in MIME_TYPES:
            raise BuildError(f"対応していない相対画像形式です: {value}")
        return self.assets_dir / unquote(parsed.path), MIME_TYPES[suffix]

    def _render_img(self, attrs: list[tuple[str, str | None]], self_closing: bool) -> str:
        rendered: list[str] = []
        for name, value in attrs:
            if value is None:
                rendered.append(name)
                continue
            if name.lower() == "src":
                target = self._relative_image_path(value)
                if target:
                    path, mime = target
                    try:
                        payload = path.read_bytes()
                    except OSError as exc:
                        raise BuildError(f"画像を読めません: {path}: {exc.strerror}") from exc
                    value = f"data:{mime};base64,{base64.b64encode(payload).decode('ascii')}"
                    self.embedded.append(str(path))
            rendered.append(f'{name}="{html.escape(value, quote=True)}"')
        ending = " />" if self_closing else ">"
        return "<img" + (" " if rendered else "") + " ".join(rendered) + ending

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        lower = tag.lower()
        if lower == "img":
            self.parts.append(self._render_img(attrs, False))
        else:
            self.parts.append(self.get_starttag_text())
        if lower not in VOID_TAGS:
            self.stack.append(lower)
        self.pending_inline_close = False
        self.pending_ascii = False

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() == "img":
            self.parts.append(self._render_img(attrs, True))
        else:
            self.parts.append(self.get_starttag_text())
        self.pending_inline_close = False
        self.pending_ascii = False

    def handle_endtag(self, tag: str) -> None:
        lower = tag.lower()
        was_excluded = self._excluded()
        self.parts.append(f"</{tag}>")
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index] == lower:
                del self.stack[index:]
                break
        # Inline closing tags are a visible predecessor even when their own text was excluded
        # (notably </code>。); a surrounding pre still suppresses the transformation.
        self.pending_inline_close = lower in INLINE_TAGS and not self._excluded() and not (
            was_excluded and lower != "code"
        )
        self.pending_ascii = False

    def handle_data(self, data: str) -> None:
        if self.japanese and not self._excluded():
            if self.pending_inline_close and data.startswith(tuple(PROHIBITED_PUNCTUATION)):
                if not data.startswith(WORD_JOINER):
                    data = WORD_JOINER + data
            pattern = rf"([A-Za-z0-9])([{re.escape(PROHIBITED_PUNCTUATION)}])"
            data = re.sub(pattern, rf"\1{WORD_JOINER}\2", data)
        self.parts.append(data)
        self.pending_inline_close = False
        self.pending_ascii = bool(data) and not self._excluded() and bool(re.search(r"[A-Za-z0-9]$", data))

    def handle_entityref(self, name: str) -> None:
        decoded = html.unescape(f"&{name};")
        if self.japanese and not self._excluded() and decoded in PROHIBITED_PUNCTUATION and (
            self.pending_inline_close or self.pending_ascii
        ):
            self.parts.append(WORD_JOINER)
        self.parts.append(f"&{name};")
        self.pending_inline_close = False
        self.pending_ascii = bool(re.fullmatch(r"[A-Za-z0-9]", decoded))

    def handle_charref(self, name: str) -> None:
        decoded = html.unescape(f"&#{name};")
        if self.japanese and not self._excluded() and decoded in PROHIBITED_PUNCTUATION and (
            self.pending_inline_close or self.pending_ascii
        ):
            self.parts.append(WORD_JOINER)
        self.parts.append(f"&#{name};")
        self.pending_inline_close = False
        self.pending_ascii = bool(re.fullmatch(r"[A-Za-z0-9]", decoded))

    def handle_comment(self, data: str) -> None:
        self.parts.append(f"<!--{data}-->")
        self.pending_inline_close = False
        self.pending_ascii = False

    def handle_decl(self, decl: str) -> None:
        self.parts.append(f"<!{decl}>")
        self.pending_inline_close = False
        self.pending_ascii = False

    def handle_pi(self, data: str) -> None:
        self.parts.append(f"<?{data}>")
        self.pending_inline_close = False
        self.pending_ascii = False

    def unknown_decl(self, data: str) -> None:
        self.parts.append(f"<![{data}]>")
        self.pending_inline_close = False
        self.pending_ascii = False


def load_config(path: Path | None, body_path: Path, script_dir: Path) -> dict:
    config = dict(DEFAULTS)
    if path:
        try:
            incoming = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise BuildError(f"設定を読めません: {path}: {exc}") from exc
        if not isinstance(incoming, dict):
            raise BuildError("設定 JSON の最上位は object にしてください")
        config.update(incoming)
    if config["layout"] not in {"document", "deck"}:
        raise BuildError("layout は document または deck にしてください")
    base = path.parent if path else body_path.parent
    config["assets_dir"] = (
        (base / config["assets_dir"]).resolve()
        if config["assets_dir"] and not Path(config["assets_dir"]).is_absolute()
        else Path(config["assets_dir"]).resolve() if config["assets_dir"] else body_path.parent
    )
    config["kit_dir"] = (
        (base / config["kit_dir"]).resolve()
        if config["kit_dir"] and not Path(config["kit_dir"]).is_absolute()
        else Path(config["kit_dir"]).resolve() if config["kit_dir"] else (script_dir / "../kit").resolve()
    )
    return config


def read_kit_files(kit_dir: Path, layout: str, mermaid: bool) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
    css_names = ["tokens.css", "board.css"] + (["deck.css"] if layout == "deck" else [])
    primary_js = ["page.js"] if layout == "document" else ["deck.js"]
    js_names = primary_js + (["beautiful-mermaid.iife.js", "mermaid-render.js"] if mermaid else []) + ["board.js"]

    def read(names: list[str]) -> list[tuple[str, str]]:
        values = []
        for name in names:
            path = kit_dir / name
            try:
                values.append((name, path.read_text(encoding="utf-8")))
            except OSError as exc:
                raise BuildError(f"kit ファイルを読めません: {path}: {exc.strerror}") from exc
        return values

    return read(css_names), read(js_names)


def transform_body(source: str, assets_dir: Path, japanese: bool) -> tuple[str, list[str]]:
    parser = BodyTransformer(assets_dir, japanese)
    try:
        parser.feed(source)
        parser.close()
    except BuildError:
        raise
    except Exception as exc:
        raise BuildError(f"body HTML を解析できません: {exc}") from exc
    return "".join(parser.parts), parser.embedded


def first_h1(source: str) -> str | None:
    parser = FirstH1Parser()
    parser.feed(source)
    parser.close()
    return parser.title


def assemble(body_source: str, config: dict) -> tuple[str, list[str], list[str]]:
    japanese = str(config["lang"]).lower().startswith("ja")
    transformed, embedded = transform_body(body_source, config["assets_dir"], japanese)
    css_files, js_files = read_kit_files(config["kit_dir"], config["layout"], bool(config["mermaid"]))
    title = config["title"] if config["title"] is not None else first_h1(body_source) or "判断ボード"

    styles = "\n".join(
        f'<style data-inline-source="{html.escape(name, quote=True)}">\n{content}\n</style>'
        for name, content in css_files
    )
    scripts = "\n".join(
        f'<script data-inline-source="{html.escape(name, quote=True)}">\n{content}\n</script>'
        for name, content in js_files
    )
    document = (
        "<!doctype html>\n"
        f'<html lang="{html.escape(str(config["lang"]), quote=True)}">\n'
        "<head>\n"
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f"<title>{html.escape(str(title))}</title>\n"
        f"{styles}\n"
        "</head>\n<body>\n"
        f"{transformed}\n"
        f"{scripts}\n"
        "</body>\n</html>\n"
    )
    return document, [name for name, _ in css_files + js_files], embedded


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--body", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--config", type=Path)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    body_path = args.body.resolve()
    config_path = args.config.resolve() if args.config else None
    try:
        body_source = body_path.read_text(encoding="utf-8")
        config = load_config(config_path, body_path, Path(__file__).resolve().parent)
        document, inlined, embedded = assemble(body_source, config)
        args.out.write_text(document, encoding="utf-8")
    except (OSError, BuildError) as exc:
        print(f"build.py: ERROR: {exc}", file=sys.stderr)
        return 1

    print("inline: " + ", ".join(inlined), file=sys.stderr)
    # Keep href untouched: kit/README/create-doc define #href as script-free navigation/zoom; only image bytes need embedding.
    print("data URI images: " + (", ".join(embedded) if embedded else "（なし）"), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
