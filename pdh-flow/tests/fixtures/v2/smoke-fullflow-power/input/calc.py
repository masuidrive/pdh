"""Tiny calculator. Supports add / sub / mul / divide."""


def add(a, b):
    return a + b


def sub(a, b):
    return a - b


def mul(a, b):
    return a * b


def divide(a, b):
    return a / b


# TODO: implement power(base, exp) per the ticket's AC.
# - AC-1: power(2, 3) == 8
# - AC-2: power(2, -1) == 0.5 (float)
# - AC-3: power(0, 0) == 1 (Python convention)
# - AC-4: power("a", 2) raises TypeError
