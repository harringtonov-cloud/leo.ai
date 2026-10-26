/**
 * Tiny arithmetic evaluator (no eval / Function). Supports + - * / % ^ ( ), unary minus,
 * constants pi, e and functions sqrt, abs, sin, cos, tan, asin, acos, atan, log (base 10), ln, exp, floor, ceil, round.
 */
const FUNCTIONS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, log: Math.log10, ln: Math.log,
  exp: Math.exp, floor: Math.floor, ceil: Math.ceil, round: Math.round,
};
const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };

export function calculate(input: string): number {
  const src = input.replace(/\s+/g, "").toLowerCase().replace(/×/g, "*").replace(/÷/g, "/").replace(/,/g, ".");
  if (!src || src.length > 300) throw new Error("Expression is empty or too long.");
  let pos = 0;

  const peek = () => src[pos];
  const eat = (ch: string) => (src[pos] === ch ? (pos++, true) : false);

  function parseExpression(): number {
    let value = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = src[pos++];
      const right = parseTerm();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  }

  function parseTerm(): number {
    let value = parseUnary();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = src[pos++];
      const right = parseUnary();
      if (op === "*") value *= right;
      else if (op === "/") value /= right;
      else value %= right;
    }
    return value;
  }

  function parsePower(): number {
    const base = parsePrimary();
    if (peek() === "^" || (peek() === "*" && src[pos + 1] === "*")) {
      pos += src[pos] === "^" ? 1 : 2;
      return Math.pow(base, parseUnary()); // right-associative; allows 2^-1
    }
    return base;
  }

  // Unary minus binds looser than ^, so -2^2 = -4.
  function parseUnary(): number {
    if (eat("-")) return -parseUnary();
    if (eat("+")) return parseUnary();
    return parsePower();
  }

  function parsePrimary(): number {
    if (eat("(")) {
      const value = parseExpression();
      if (!eat(")")) throw new Error("Missing closing parenthesis.");
      return value;
    }
    const number = src.slice(pos).match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/);
    if (number) {
      pos += number[0].length;
      return Number(number[0]);
    }
    const word = src.slice(pos).match(/^[a-z]+/);
    if (word) {
      const name = word[0];
      pos += name.length;
      if (name in CONSTANTS) return CONSTANTS[name];
      if (name in FUNCTIONS) {
        if (!eat("(")) throw new Error(`Function ${name} needs parentheses.`);
        const arg = parseExpression();
        if (!eat(")")) throw new Error("Missing closing parenthesis.");
        return FUNCTIONS[name](arg);
      }
      throw new Error(`Unknown name: ${name}`);
    }
    throw new Error(`Unexpected character at position ${pos + 1}.`);
  }

  const result = parseExpression();
  if (pos !== src.length) throw new Error(`Unexpected character at position ${pos + 1}.`);
  if (!Number.isFinite(result)) throw new Error("Result is not a finite number.");
  return result;
}
