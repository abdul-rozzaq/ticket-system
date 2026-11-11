# Documentation

## Start here

| Document                           | What it answers                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| [status.md](status.md)             | What exists, what is verified automatically, what has never touched a real service |
| [progress.md](progress.md)         | Short done / remaining overview                                                    |
| [features.md](features.md)         | Feature list with a verification verdict per feature                               |
| [architecture.md](architecture.md) | Components, flows, trust boundaries, failure behaviour, code layout                |
| [plan.md](plan.md)                 | Design decisions and the phase plan                                                |

## Guides

| Guide                                                              | Topic                                                             |
| ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| [guides/development.md](guides/development.md)                     | Local development, tests, environment variables                   |
| [guides/deployment.md](guides/deployment.md)                       | Docker compose, backups, CI, image publishing, extension releases |
| [guides/admin-panel.md](guides/admin-panel.md)                     | The admin panel: running it, auth model, pages                    |
| [guides/userbot.md](guides/userbot.md)                             | Logging the TP account in, discovery, ban-risk notes              |
| [guides/bot.md](guides/bot.md)                                     | Internal bot setup and linking staff                              |
| [guides/funnel-and-folders.md](guides/funnel-and-folders.md)       | Kanban funnel and Telegram folder sync                            |
| [guides/knowledge-base-and-ai.md](guides/knowledge-base-and-ai.md) | Knowledge base, AI provider setup, drafts                         |
| [../apps/extension/README.md](../apps/extension/README.md)         | Chrome extension: build, install, releases                        |

## Testing

[testing/manual-tests.md](testing/manual-tests.md): the checklist for everything that automated tests cannot cover
(real Telegram, real AI provider, real Chrome).
