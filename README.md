# GitScribe
### An automated GitLab progress reporter with burndown chart generation
***

## Quick Start

#### Running as an application

```
# Install the package
npm install gitscribe

gitscribe burndown \
  --host='https://gitlab.example.com' \
  --token='[personal token with API privilege]' \
  --group='group name' \
  --milestone='milestone title' \
  --output='burndown-chart.png'
```

#### Using as a library

```
# Install the package
npm install gitscribe
```

```JavaScript
const GitScribe = require('gitscribe');

const GITLAB_HOST = 'https://gitlab.example.com'
const {GITLAB_TOKEN} = process.env;

const scribe = new GitScribe(GITLAB_HOST, GITLAB_TOKEN);

const groups = scribe.fetchGroups();
const group = groups[0];

const milestones = await scribe.fetchMilestones(group);
const milestone = milestones[0];

const issues = await scribe.fetchMilestoneIssues(group, milestone);
await scribe.fetchAndMergeIssueDiscussions(issues);

const image = await scribe.generateBurndownChart(milestone, issues);
```

#### Running from source

```
# Clone the repository
git clone git@github.com/AlexGustafsson/gitscribe

# Enter the repository and install the dependencies
cd gitscribe
npm install

# Link the CLI utility
npm link

gitscribe --help
```

## Documentation

### CLI

The documentation for running GitScribe as a CLI utility is currently a bit sparse. Please refer to the source code and the output from `gitscribe --help`.

### Library

The documentation for using GitScribe as a library is currently a bit sparse. Please refer to the source code.

## Contributing

### Guidelines

```
# Clone the repository
git clone git@github.com/AlexGustafsson/gitscribe

# Install dependencies
npm install

# Link for CLI testing
npm link

# Write code and commit it

# Follow the conventions enforced
npm run lint-javascript
npm run lint-shell
npm run test
npm run coverage
npm run check-duplicate-code
```

### Dependencies

This project targets NodeJS 13.

#### Development dependencies

**The following dependencies need to be manually installed.**

* [ShellCheck](https://github.com/koalaman/shellcheck)
  * `brew install shellcheck`
  * `apt install shellcheck`

#### Runtime dependencies

**The following dependencies need to be manually installed.**

* [imagemagick](https://imagemagick.org/index.php)
