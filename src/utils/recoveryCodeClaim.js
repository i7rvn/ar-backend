async function consumeMatchingCode(rows, code, verify, claim) {
  for (const row of rows) {
    if (await verify(row.code_hash, code)) {
      return claim(row.id);
    }
  }
  return false;
}

module.exports = { consumeMatchingCode };

