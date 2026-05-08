import unittest

from calc import add, divide, mul, sub


class TestCalc(unittest.TestCase):
    def test_add(self):
        self.assertEqual(add(2, 3), 5)

    def test_sub(self):
        self.assertEqual(sub(5, 3), 2)

    def test_mul(self):
        self.assertEqual(mul(2, 3), 6)

    def test_divide_basic(self):
        result = divide(6, 2)
        self.assertEqual(result, 3.0)
        self.assertIsInstance(result, float)

    def test_divide_by_zero(self):
        with self.assertRaises(ZeroDivisionError):
            divide(1, 0)

    # TODO: tests for percentage once implemented (AC-1..AC-5)


if __name__ == "__main__":
    unittest.main()
