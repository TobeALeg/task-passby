# WildChat handoff experiment

This directory implements the preregistered comparison in
[`docs/design/wildchat-handoff-evaluation-v1.md`](../../docs/design/wildchat-handoff-evaluation-v1.md).

The runner:

1. freezes the current Hugging Face dataset revision and samples deterministic
   pages from the official Dataset Viewer API;
2. locally drops non-GPT-4o, short, toxic, redacted, sensitive, high-risk and
   over-limit conversations;
3. uses a Bailian screening pass to select continuous, history-dependent work;
4. creates a response-blind handoff contract and both H2/H3 packages;
5. runs `deepseek-v3` twice on H0 full history, H1 recent window, H2 current
   Worket state, H3 minimal-sufficient brief, plus H4 on a fixed subset;
6. sends blind, shuffled outputs to two Bailian judges and computes
   conversation-clustered bootstrap intervals.

The API key is read at runtime and is never written to a request cache or
report. Raw conversations, provider responses and judgments stay below the
Git-ignored `output/` directory. The committed manifest contains only upstream
row/turn identifiers, labels and aggregate metadata.

Run a local logic check:

```powershell
node experiments/wildchat-handoff/run.mjs selftest
```

Run all network and model phases (the default key file matches the local
experiment machine):

```powershell
node experiments/wildchat-handoff/run.mjs all `
  --key-file C:\Users\Dandi\Desktop\aliapikey.txt `
  --output output\wildchat-handoff
```

Every provider request is content-addressed under `output/.../cache`, so an
interrupted run resumes without paying for completed calls. Phase commands are
`preflight`, `sample`, `prepare`, `respond`, `judge`, and `report`; later phases
load the prior private state.

This is an automated benchmark, not the human-reviewed product proof described
in the broader evaluation method. WildChat has no files, tools, acceptance
tests, user correction time, or real agent-switch event. The generated report
therefore answers only which context representation best preserves a natural
chat continuation under these controls.
