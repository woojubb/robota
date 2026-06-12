# Demo Recording Script

This document explains how to record the `demo.gif` file used in `README.md`.

## Prerequisites

Install the required tools:

```bash
# asciinema — terminal session recorder
brew install asciinema

# agg — converts asciinema cast to GIF
cargo install agg
# or: brew install agg  (if available via Homebrew)
```

## Recording Steps

1. Start a fresh terminal session with a clean working directory:

   ```bash
   mkdir /tmp/robota-demo && cd /tmp/robota-demo
   export ANTHROPIC_API_KEY=sk-ant-...
   ```

2. Record the session (target: under 2 minutes):

   ```bash
   asciinema rec demo.cast --cols 100 --rows 30
   ```

3. Inside the recording, run the following demo scenario:

   ```
   npx @robota-sdk/agent-cli
   # (wait for first-run setup, select Anthropic provider)
   # At the prompt:
   > Read the file README.md and give me a one-sentence summary
   # (wait for AI response)
   > /exit
   ```

4. Stop recording with `Ctrl+D` or `exit`.

5. Convert to GIF:

   ```bash
   agg demo.cast demo.gif --font-size 16 --speed 1.5
   ```

6. Verify file size is under 5 MB:

   ```bash
   ls -lh demo.gif
   ```

   If the file is over 5 MB, reduce speed or trim the cast:

   ```bash
   # Increase speed to reduce file size
   agg demo.cast demo.gif --font-size 16 --speed 2.5
   ```

7. Copy the output to the docs directory:

   ```bash
   cp demo.gif /path/to/robota/packages/agent-cli/docs/demo.gif
   ```

## Notes

- Use a terminal with a dark theme (e.g., iTerm2 with Solarized Dark) for best visual contrast.
- Aim for a 90–120 second scenario: first-run setup → read a file → AI response.
- GIF should be 5 MB or smaller to keep README load times fast.
- After placing the GIF, remove the `<!-- TODO -->` comment from `README.md`.
