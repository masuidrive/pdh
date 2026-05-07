"""Minimal AST-based expression evaluator for the calc demo. NOTE: round-1 starts with ZeroDivisionError NOT caught — repair fixes it."""
import ast
import operator
import sys

OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
}


def evaluate(node):
    if isinstance(node, ast.Expression):
        return evaluate(node.body)
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.BinOp):
        op = OPS.get(type(node.op))
        if op is None:
            raise ValueError(f"unsupported op: {type(node.op).__name__}")
        return op(evaluate(node.left), evaluate(node.right))
    raise ValueError(f"unsupported node: {type(node).__name__}")


def main(argv=None):
    argv = argv or sys.argv[1:]
    if len(argv) != 1:
        print("usage: calc <expression>", file=sys.stderr)
        return 2
    tree = ast.parse(argv[0], mode="eval")
    result = evaluate(tree)
    print(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
