// The YAML block of one rule: from its `- id:` line to the next rule or the end of the document.
export function ruleBlock(yaml: string, ruleId: string): string | undefined {
  const lines = yaml.split('\n');
  const start = lines.findIndex(
    (line) => /^\s*-\s*id:\s*/.test(line) && line.split(':')[1]?.trim() === ruleId,
  );
  if (start < 0) return undefined;
  const rest = lines.slice(start + 1);
  const stop = rest.findIndex((line) => /^\s*-\s*id:\s*/.test(line) || /^\S/.test(line));
  const body = stop < 0 ? rest : rest.slice(0, stop);
  return [lines[start], ...body].join('\n').trimEnd();
}
