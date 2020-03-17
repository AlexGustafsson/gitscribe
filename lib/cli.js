#!/usr/bin/env node
const fs = require('fs');

const debug = require('debug')('gitscribe:cli');
const program = require('commander');

const {version} = require('../package.json');

const GitScribe = require('./gitscribe');

program.version(version, '-v, --version', 'output the current version');
program.helpOption('-h, --help', 'display this help text');
program.option('-d, --debug', 'run in debug mode');

program.on('option:debug', () => {
  require('debug').enable('gitscribe:*');
});

program
  .command('burndown')
  .description('generate a burndown chart for a milestone')
  .requiredOption('-h, --host [host]', 'a URL to the GitLab instance')
  .requiredOption('-t, --token [token]', 'the GitLab personal token with API access rights to use')
  .requiredOption('-m, --milestone [milestone]', 'the title of the milestone for which to generate the report')
  .requiredOption('-g, --group [group]', 'the name of the group for which to generate the report')
  .requiredOption('-o, --output [path]', 'the path to the output PNG file')
  .option('-s, --storypoints', 'use a label storypoints::[0-9]+ as effort marker instead of time')
  .option('--include-open', 'include effort of open issues when calculating burndown')
  .option('-w, --width [width]', 'the width of the chart in pixels (default 1420px)')
  .option('-h, --height [height]', 'the height of the chart in pixels (default 720px)')
  .option('--use-estimate', 'use the effort estimate instead of the effort spent')
  .action(async options => {
    debug(`Will generate report for milestone '${options.milestone}' of group '${options.group}' at host '${options.host}'`);
    const scribe = new GitScribe(options.host, options.token);

    const groups = await scribe.fetchGroups();
    const group = groups.find(x => x.name === options.group);

    const milestones = await scribe.fetchMilestones(group);
    const milestone = milestones.find(x => x.title === options.milestone);

    const issues = await scribe.fetchMilestoneIssues(group, milestone);
    await scribe.fetchAndMergeIssueDiscussions(issues);

    const getStorypoints = issue => {
      const storypointsLabel = issue.labels.find(label => label.indexOf('storypoints::') === 0);
      if (storypointsLabel)
        return {total: Number(storypointsLabel.replace('storypoints::', '')), days: {}};
      return {total: 0, days: {}};
    };

    const burndownOptions = {};

    if (options.storypoints) {
      burndownOptions.getEffort = getStorypoints;
      burndownOptions.getEffortEstimate = getStorypoints;
    }

    if (options.width)
      burndownOptions.width = options.width;

    if (options.height)
      burndownOptions.height = options.height;

    if (options.includeOpen)
      burndownOptions.includeOpen = true;

    if (options.useEstimate)
      burndownOptions.useEstimate = true;

    const image = await scribe.generateBurndownChart(milestone, issues, burndownOptions);
    await fs.promises.writeFile(options.output, image, 'binary');
  });

program.parse(process.argv);
