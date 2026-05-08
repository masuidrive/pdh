"""Tiny calculator. Supports add / sub / mul / divide."""


def add(a, b):
    return a + b


def sub(a, b):
    return a - b


def mul(a, b):
    return a * b


def divide(a, b):
    return a / b


# TODO: implement modulo(a, b) per the ticket's AC.
# - AC-1: modulo(7, 3) == 1
# - AC-2: modulo(7, 0) raises ZeroDivisionError
# - AC-3: modulo(-7, 3) == 2 (Python convention; do NOT mimic C's sign-of-dividend)
