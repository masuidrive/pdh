import ast
import operator
import sys


ALLOWED_BINOPS = {
    ast.Add: operator.add,
}


def evaluate(expression):
    tree = ast.parse(expression, mode="eval")
    return evaluate_node(tree.body)


def evaluate_node(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, int):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in ALLOWED_BINOPS:
        left = evaluate_node(node.left)
        right = evaluate_node(node.right)
        return ALLOWED_BINOPS[type(node.op)](left, right)
    raise ValueError("unsupported expression")


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 1:
        print("usage: calc EXPRESSION", file=sys.stderr)
        return 2
    try:
        print(evaluate(args[0]))
        return 0
    except (SyntaxError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
