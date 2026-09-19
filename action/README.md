# Lens — show, don't screenshot

A GitHub Action that screenshots your deployed web UI on every push, so UI
reviews stop depending on manual screenshots.

## What it is

`action.yml` is a composite action. Point it at a deployed URL and it
captures full-page desktop (1440×900) and mobile (390×844) screenshots with
headless Chromium via Playwright, then uploads them as a workflow artifact.
No secrets required — it only needs the public URL.

## Inputs

| Input    | Required | Default | Description                                                                                                                             |
| -------- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `url`    | yes      | —       | The page to screenshot (your deployed URL).                                                                                             |
| `name`   | no       | `page`  | Prefix for the PNG files and the artifact name.                                                                                         |
| `base-url` | no     | —       | Optional base URL to diff against (e.g. production). When set, also captures base screenshots and generates visual diffs.                |

## Example usage

```yaml
- name: Capture UI screenshots
  uses: PrachiDPatel/lens/action@main
  with:
    url: https://your-deployed-site.example.com
    name: homepage
```

See `example-workflow.yml` for complete caller workflows: one that screenshots on
pushes to `main` that touch frontend files (adjust the `paths` filter to your
repo), and one that runs a visual regression on pull requests, diffing the PR
deploy preview against production.

## What you get

One artifact per run named `lens-<name>` (e.g. `lens-homepage`) containing:

- `<name>-desktop.png` — full-page screenshot at 1440×900
- `<name>-mobile.png` — full-page screenshot at 390×844

When `base-url` is set, the artifact also contains:

- `<name>-base-desktop.png`, `<name>-base-mobile.png` — the base URL captured
  with the same viewports and settle wait
- `<name>-desktop-diff.png`, `<name>-mobile-diff.png` — pixelmatch diffs
  (changed pixels highlighted red) comparing base vs head

Artifacts are kept for 14 days. Find them under the workflow run's
**Artifacts** section. The changed-pixel counts are also written to the job
summary.

## Visual regression on pull requests

Point `url` at your PR's deployed preview and `base-url` at production to get
an automatic before/after diff on every PR:

```yaml
- name: Visual regression
  uses: PrachiDPatel/lens/action@main
  with:
    url: https://pr-123-preview.example.com # your PR deploy preview
    base-url: https://example.com # production
    name: pr-preview
```

See `example-workflow.yml` for a complete pull-request caller workflow. Note
that pixelmatch compares exact pixels, so the diff flags *any* rendering
difference — animated content, timestamps, and A/B tests will show up as
changed. A pair is skipped (with a warning) if the two screenshots have
different dimensions, which can happen when page height changes between
captures.

## Notes

- Screenshots are full-page captures with a 3-second settle wait before each
  shot, so late-loading content usually lands in frame.
- The action screenshots the URL you give it. If your deploy happens in the
  same workflow, run Lens in a job that `needs` the deploy job so the URL is
  live first.
- Intended review loop: an AI with access to the repo can fetch the PNGs via
  the GitHub API (`actions/artifacts` → download URL) and look at the actual
  rendered UI instead of asking for screenshots.
