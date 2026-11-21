/**
 * Typeset math notation used in otherwise plain lesson text and graph legends.
 *
 * AI and graph tools may provide safe canonical expressions such as x^2.
 * Plain HTML escaping shows the caret literally in PDFs. Convert only
 * bounded exponent/base notation to native HTML sup/sub (after escaping),
 * leaving the mathematical source and its server-side QA untouched.
 *
 * This function never trusts or passes user-supplied HTML through.
 */
const escape = value => String(value ?? '')
  .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  .replaceAll('"','&quot;').replaceAll("'","&#39;");

export function formatPlainMathText(value) {
  return escape(value)
    // e^(x-2), 2^(n+1), (x+1)^(-2)
    .replace(/\^\(([A-Za-z0-9+\-*/. ]{1,80})\)/g, '<sup>$1</sup>')
    // x^2, x^10, x^-3: exponent is raised, not a literal caret.
    .replace(/\^(-?\d{1,3})(?![A-Za-z0-9])/g, '<sup>$1</sup>')
    // log_10 or x_1: indices use subscripts instead of underscores.
    .replace(/_(-?\d{1,3})(?![A-Za-z0-9])/g, '<sub>$1</sub>');
}
