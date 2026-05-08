"""Tiny calculator. Supports add / sub / mul / divide."""


def add(a, b):
    return a + b


def sub(a, b):
    return a - b


def mul(a, b):
    return a * b


def divide(a, b):
    return a / b


# TODO: implement clamp(value, lo, hi) per the ticket's AC.
# - AC-1: clamp(5, 0, 10) == 5  (in range)
# - AC-2: clamp(-3, 0, 10) == 0  (below range)
# - AC-3: clamp(20, 0, 10) == 10  (above range)
# - AC-4: clamp(5, 10, 0) raises ValueError  (lo > hi)
