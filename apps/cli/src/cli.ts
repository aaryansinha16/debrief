const USAGE = [
  'usage: debrief claude-code <install | uninstall | hook>',
  '  install    add the Stop hook to Claude Code user settings (--api <url> --key <dbf_…>)',
  '  uninstall  remove the hook and restore the settings it changed',
  '  hook       what the hook runs: posts new transcript lines and the git state',
  '',
].join('\n');

process.stderr.write(USAGE);
process.exitCode = 2;
