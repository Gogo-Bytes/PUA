// Offline transport fixture; never contacts an LLM or loads the user's Pi configuration.
process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdout.write('\x1b[?2004h\x1b[32mMOCK_PI_READY\x1b[0m\r\n');
process.stdout.write(`CWD=${process.cwd()}\r\nARGS=${JSON.stringify(process.argv.slice(2))}\r\n`);
let received = '';
process.stdin.on('data', chunk => {
  const data = chunk.toString('utf8');
  received += data;
  if (data.includes('\x04')) { process.exit(0); }
  if (data.includes('\x02')) {
    process.stdout.write(`\r\nINPUT_BASE64=${Buffer.from(received.replaceAll('\x02', '')).toString('base64')}\r\n`);
    received = '';
  }
  if (data.includes('\x07')) {
    for (let index = 0; index < 15000; index++) process.stdout.write(`flow-${index.toString().padStart(5, '0')}\r\n`);
    process.stdout.write('FLOW_COMPLETE\r\n');
  }
});
process.on('SIGWINCH', () => process.stdout.write(`SIZE=${process.stdout.columns}x${process.stdout.rows}\r\n`));
