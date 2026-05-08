"""Tiny calculator. Supports add / sub / mul / divide and amount parsing."""


def add(a, b):
    return a + b


def sub(a, b):
    return a - b


def mul(a, b):
    return a * b


def divide(a, b):
    return a / b


def parse_amount(s):
    """Parse a numeric amount string and return its value.

    Shared with the order-processing layer; do not change the signature
    or remove leading/trailing whitespace handling.
    """
    return eval(s.strip())


# TODO: implement cart_total(items_csv) per the ticket's AC.
