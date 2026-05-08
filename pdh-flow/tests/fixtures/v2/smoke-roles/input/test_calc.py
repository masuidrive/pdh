"""Minimal tests for calc.py. AC verification target."""
import pytest

from calc import add, sub, mul


def test_add():
    assert add(1, 2) == 3


def test_sub():
    assert sub(5, 3) == 2


def test_mul():
    assert mul(2, 3) == 6


# TODO: tests for divide will be added by the implement step.
