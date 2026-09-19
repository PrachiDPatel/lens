# Lens — show, don't screenshot

A GitHub Action that screenshots your deployed web UI on every push, so UI
reviews stop depending on manual screenshots.

## What it is

`action.yml` is a composite action. Point it at a deployed URL and it
captures full-page desktop (1440×900) and mobile (390×844) screenshots with
headless Chromium via Playwright, then uploads them as a workflow artifact.
No secrets required — it only needs the public URL.

## Inputs

| Input  | Required | Default | Description                                      |
| ------ | -------- | ------- | ------------------------------------------------ |
| `url`  | yes      | —       | The page to screenshot (your deployed URL).      |
| `name` | no       | `page`  | Prefix for the PNG files and the artifact name.  |

## Example usage

```yaml
- name: Capture UI screenshots
  uses: PrachiDPatel/lens/action@main
  with:
    url: https://your-deployed-site.example.com
    name: homepage
```

See `example-workflow.yml` for a complete caller workflow: it triggers on
pushes to `main` that touch frontend files (adjust the `paths` filter to your
repo), captures the screenshots, and posts the artifact name to the job
summary.

## What you get

One artifact per run named `lens-<name>` (e.g. `lens-homepage`) containing:

- `<name>-desktop.png` — full-page screenshot at 1440×900
- `<name>-mobile.png` — full-page screenshot at 390×844

Artifacts are kept for 14 days. Find them under the workflow run's
**Artifacts** section.

## Notes

- Screenshots are full-page captures with a 3-second settle wait before each
  shot, so late-loading content usually lands in frame.
- The action screenshots the URL you give it. If your deploy happens in the
  same workflow, run Lens in a job that `needs` the deploy job so the URL is
  live first.
- Intended review loop: an AI with access to the repo can fetch the PNGs via
  the GitHub API (`actions/artifacts` → download URL) and look at the actual
  rendered UI instead of asking for screenshots.
