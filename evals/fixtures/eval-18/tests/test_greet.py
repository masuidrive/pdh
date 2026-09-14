"""挨拶 CLI の言語選択と引数エラーを検証する。"""
from pathlib import Path
import subprocess
import sys
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "src" / "greet.py"


class GreetCliTests(unittest.TestCase):
    def test_greetings(self):
        cases = (
            (["Alice"], "こんにちは、Aliceさん！\n"),
            (["太郎"], "こんにちは、太郎さん！\n"),
            (["--lang", "ja", "太郎"], "こんにちは、太郎さん！\n"),
            (["--lang", "en", "Alice"], "Hello, Alice!\n"),
            (["--lang", "en", "太郎"], "Hello, 太郎!\n"),
            (["--lang", "en", "Alice Smith"], "Hello, Alice Smith!\n"),
            (["--lang", "fr", "Alice"], "Bonjour Alice !\n"),
            (["--lang", "fr", "太郎"], "Bonjour 太郎 !\n"),
            (["--lang", "fr", "--upper", "Alice"], "BONJOUR ALICE !\n"),
            (
                ["--lang", "fr", "--repeat", "2", "Alice"],
                "Bonjour Alice !\nBonjour Alice !\n",
            ),
            (["--mark-0518", "太郎"], "こんにちは、太郎さん！ [0518]\n"),
            (["太郎", "--mark-0518"], "こんにちは、太郎さん！ [0518]\n"),
            (["--lang", "en", "--upper", "--mark-0518", "Taro"], "HELLO, TARO! [0518]\n"),
            (["--lang", "en", "--shout", "--mark-0518", "Taro"], "Hello, Taro!!! [0518]\n"),
            (
                ["--repeat", "3", "--mark-0518", "Alice"],
                "こんにちは、Aliceさん！ [0518]\n" * 3,
            ),
            (["--lang", "en", "--mark-0518", "Alice"], "Hello, Alice! [0518]\n"),
            (["--lang", "ja", "--mark-0518", "Alice"], "こんにちは、Aliceさん！ [0518]\n"),
            (["--lang", "fr", "--mark-0518", "Alice"], "Bonjour Alice ! [0518]\n"),
            (["--mark-0601", "太郎"], "こんにちは、太郎さん！ [0601]\n"),
            (["太郎", "--mark-0601"], "こんにちは、太郎さん！ [0601]\n"),
            (["--lang", "en", "--upper", "--mark-0601", "Taro"], "HELLO, TARO! [0601]\n"),
            (["--lang", "en", "--shout", "--mark-0601", "Taro"], "Hello, Taro!!! [0601]\n"),
            (
                ["--repeat", "3", "--mark-0601", "Alice"],
                "こんにちは、Aliceさん！ [0601]\n" * 3,
            ),
            (["--lang", "en", "--mark-0601", "Alice"], "Hello, Alice! [0601]\n"),
            (["--lang", "ja", "--mark-0601", "Alice"], "こんにちは、Aliceさん！ [0601]\n"),
            (["--lang", "fr", "--mark-0601", "Alice"], "Bonjour Alice ! [0601]\n"),
            # AC 7: --mark-0518 と --mark-0601 併用時、順序は [0518] [0601] で固定。
            (["--mark-0518", "--mark-0601", "太郎"], "こんにちは、太郎さん！ [0518] [0601]\n"),
            (["--mark-0601", "--mark-0518", "太郎"], "こんにちは、太郎さん！ [0518] [0601]\n"),
            (
                ["--lang", "en", "--upper", "--mark-0518", "--mark-0601", "Taro"],
                "HELLO, TARO! [0518] [0601]\n",
            ),
            (
                ["--lang", "en", "--shout", "--mark-0518", "--mark-0601", "Taro"],
                "Hello, Taro!!! [0518] [0601]\n",
            ),
            (
                ["--repeat", "2", "--mark-0518", "--mark-0601", "Alice"],
                "こんにちは、Aliceさん！ [0518] [0601]\n" * 2,
            ),
            (["--mark-0641", "太郎"], "こんにちは、太郎さん！ [0641]\n"),
            (["太郎", "--mark-0641"], "こんにちは、太郎さん！ [0641]\n"),
            (["--lang", "en", "--upper", "--mark-0641", "Taro"], "HELLO, TARO! [0641]\n"),
            (["--lang", "en", "--shout", "--mark-0641", "Taro"], "Hello, Taro!!! [0641]\n"),
            (
                ["--repeat", "3", "--mark-0641", "Alice"],
                "こんにちは、Aliceさん！ [0641]\n" * 3,
            ),
            (["--lang", "en", "--mark-0641", "Alice"], "Hello, Alice! [0641]\n"),
            (["--lang", "ja", "--mark-0641", "Alice"], "こんにちは、Aliceさん！ [0641]\n"),
            (["--lang", "fr", "--mark-0641", "Alice"], "Bonjour Alice ! [0641]\n"),
            # AC 7: --mark-0518 / --mark-0601 / --mark-0641 併用時、順序は
            # [0518] [0601] [0641] で固定。指定順を変えても出力順は変わらない。
            (
                ["--mark-0518", "--mark-0601", "--mark-0641", "太郎"],
                "こんにちは、太郎さん！ [0518] [0601] [0641]\n",
            ),
            (
                ["--mark-0641", "--mark-0601", "--mark-0518", "太郎"],
                "こんにちは、太郎さん！ [0518] [0601] [0641]\n",
            ),
            (
                ["--mark-0601", "--mark-0641", "--mark-0518", "太郎"],
                "こんにちは、太郎さん！ [0518] [0601] [0641]\n",
            ),
            (
                [
                    "--lang", "en", "--upper",
                    "--mark-0518", "--mark-0601", "--mark-0641", "Taro",
                ],
                "HELLO, TARO! [0518] [0601] [0641]\n",
            ),
            (
                [
                    "--lang", "en", "--shout",
                    "--mark-0518", "--mark-0601", "--mark-0641", "Taro",
                ],
                "Hello, Taro!!! [0518] [0601] [0641]\n",
            ),
            (
                ["--repeat", "2", "--mark-0518", "--mark-0601", "--mark-0641", "Alice"],
                "こんにちは、Aliceさん！ [0518] [0601] [0641]\n" * 2,
            ),
        )
        for name in ("-Alice", "--Alice", "--", "-h", "--help",
                     "--shout=Alice", "--shout=", "--s", "--sh", "--sho", "--shou",
                     "--mark-0518=Alice", "--mark-0518=", "--mark", "--mark-",
                     "--mark-0601=Alice", "--mark-0601=",
                     "--mark-0641=Alice", "--mark-0641="):
            cases += (
                ([name], f"こんにちは、{name}さん！\n"),
                (["--lang", "ja", name], f"こんにちは、{name}さん！\n"),
                (["--lang", "en", name], f"Hello, {name}!\n"),
                (["--lang", "fr", name], f"Bonjour {name} !\n"),
            )
        for lang, template in (
            (None, "こんにちは、{}さん！"),
            ("ja", "こんにちは、{}さん！"),
            ("en", "Hello, {}!"),
            ("fr", "Bonjour {} !"),
        ):
            for name in ("Alice", "太郎", "a!b！！!", "", "--shout"):
                for shout in (False, True):
                    for upper in (False, True):
                        for mark in (False, True):
                            for mark0601 in (False, True):
                                for mark0641 in (False, True):
                                    for repeat in (1, 2):
                                        options = ["--repeat", str(repeat)]
                                        if lang is not None:
                                            options += ["--lang", lang]
                                        if shout:
                                            options += ["--shout"]
                                        if upper:
                                            options += ["--upper"]
                                        if mark:
                                            options += ["--mark-0518"]
                                        if mark0601:
                                            options += ["--mark-0601"]
                                        if mark0641:
                                            options += ["--mark-0641"]
                                        message = template.format(name)
                                        if shout:
                                            message = template[:-1].format(name) + "!!!"
                                        if upper:
                                            message = message.upper()
                                        if mark:
                                            message = message + " [0518]"
                                        if mark0601:
                                            message = message + " [0601]"
                                        if mark0641:
                                            message = message + " [0641]"
                                        expected = (message + "\n") * repeat
                                        cases += (([*options, "--", name], expected),)
                                        if not name.startswith("--"):
                                            cases += (([name, *options], expected),)
        cases += (
            (["--shout", "Alice"], "こんにちは、Aliceさん!!!\n"),
            (["--", "--shout"], "こんにちは、--shoutさん！\n"),
            (["--lang", "en", "--", "--shout"], "Hello, --shout!\n"),
            (["--", "--mark-0518"], "こんにちは、--mark-0518さん！\n"),
            (["--lang", "en", "--", "--mark-0518"], "Hello, --mark-0518!\n"),
            (["--", "--mark-0601"], "こんにちは、--mark-0601さん！\n"),
            (["--lang", "en", "--", "--mark-0601"], "Hello, --mark-0601!\n"),
            (["--", "--mark-0641"], "こんにちは、--mark-0641さん！\n"),
            (["--lang", "en", "--", "--mark-0641"], "Hello, --mark-0641!\n"),
        )
        for option in ("--l", "--la", "--lan"):
            for shout in ([], ["--shout"]):
                suffix = "!!!" if shout else "!"
                cases += (([option, "en", "Alice", *shout], f"Hello, Alice{suffix}\n"),)
                cases += (([f"{option}=en", "Alice", *shout], f"Hello, Alice{suffix}\n"),)
        for repeat in ("--r", "--re", "--rep", "--repe", "--repea"):
            for upper in ("--u", "--up", "--upp", "--uppe"):
                cases += (([repeat, "2", upper, "Alice"], "こんにちは、ALICEさん！\n" * 2),)
                cases += ((["Alice", f"{repeat}=2", upper, "--shout"], "こんにちは、ALICEさん!!!\n" * 2),)
                cases += (
                    (
                        [repeat, "2", upper, "--mark-0518", "Alice"],
                        "こんにちは、ALICEさん！ [0518]\n" * 2,
                    ),
                )
                cases += (
                    (
                        [repeat, "2", upper, "--mark-0601", "Alice"],
                        "こんにちは、ALICEさん！ [0601]\n" * 2,
                    ),
                )
                cases += (
                    (
                        [repeat, "2", upper, "--mark-0641", "Alice"],
                        "こんにちは、ALICEさん！ [0641]\n" * 2,
                    ),
                )
        for args, expected in cases:
            with self.subTest(args=args):
                result = subprocess.run(
                    [sys.executable, str(SCRIPT), *args],
                    capture_output=True, text=True, encoding="utf-8",
                )
                self.assertEqual(result.returncode, 0)
                self.assertEqual(result.stdout, expected)
                self.assertEqual(result.stderr, "")

    def test_argument_errors(self):
        cases = (
            ["--lang", "de", "Alice"],
            ["--lang", "EN", "Alice"],
            ["--lang", "de", "-Alice"],
            ["--lang"],
            ["--lang", "ja"],
            ["--lang", "en"],
            [],
            ["Alice", "Bob"],
        )
        cases += (
            ["--shout"],
            ["--lang", "ja", "--shout"],
            ["--lang", "en", "--shout"],
            ["--lang", "fr", "--shout"],
            ["--shout", "--lang", "de", "Alice"],
            ["--shout", "Alice", "Bob"],
        )
        for flag in ("--s", "--sh", "--sho", "--shou"):
            cases += ([flag, "Alice"], ["Alice", flag])
        cases += (
            ["--mark-0518"],
            ["--lang", "ja", "--mark-0518"],
            ["--lang", "en", "--mark-0518"],
            ["--lang", "fr", "--mark-0518"],
            ["--mark-0518", "--lang", "de", "Alice"],
            ["--mark-0518", "Alice", "Bob"],
        )
        cases += (
            ["--mark-0601"],
            ["--lang", "ja", "--mark-0601"],
            ["--lang", "en", "--mark-0601"],
            ["--lang", "fr", "--mark-0601"],
            ["--mark-0601", "--lang", "de", "Alice"],
            ["--mark-0601", "Alice", "Bob"],
            ["--mark-0518", "--mark-0601"],
            ["--mark-0518", "--mark-0601", "Alice", "Bob"],
        )
        cases += (
            ["--mark-0641"],
            ["--lang", "ja", "--mark-0641"],
            ["--lang", "en", "--mark-0641"],
            ["--lang", "fr", "--mark-0641"],
            ["--mark-0641", "--lang", "de", "Alice"],
            ["--mark-0641", "Alice", "Bob"],
            ["--mark-0518", "--mark-0641"],
            ["--mark-0601", "--mark-0641"],
            ["--mark-0518", "--mark-0601", "--mark-0641"],
            ["--mark-0518", "--mark-0601", "--mark-0641", "Alice", "Bob"],
        )
        for value in ("abc", "1.5", "0", "-1"):
            for shout in ([], ["--shout"]):
                cases += (([*shout, "--repeat", value, "Alice"]),)
            for mark in ([], ["--mark-0518"]):
                cases += (([*mark, "--repeat", value, "Alice"]),)
            for mark0601 in ([], ["--mark-0601"]):
                cases += (([*mark0601, "--repeat", value, "Alice"]),)
            for mark0641 in ([], ["--mark-0641"]):
                cases += (([*mark0641, "--repeat", value, "Alice"]),)
        for args in cases:
            with self.subTest(args=args):
                result = subprocess.run(
                    [sys.executable, str(SCRIPT), *args],
                    capture_output=True, text=True, encoding="utf-8",
                )
                self.assertEqual(result.returncode, 2)
                self.assertEqual(result.stdout, "")
                self.assertIn("usage:", result.stderr)
                self.assertIn("error:", result.stderr)


if __name__ == "__main__":
    unittest.main()
