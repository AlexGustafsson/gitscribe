const debug = require('debug')('gitscribe:gitscribe');
const {Gitlab} = require('gitlab');
const {CanvasRenderService} = require('chartjs-node-canvas');

const MILLISECONDS_IN_DAY = 24 * 60 * 60 * 1000;

class GitScribe {
  /**
  * Connect to a GitLab instance.
  * @param host {String} - GitLab Instance Host URL.
  * @param token {String} - Personal GitLab Token with the API privilege.
  */
  constructor(host, token) {
    this.host = host;
    this.api = new Gitlab({
      host,
      token,
      camelize: true
    });
  }

  /**
  * Fetch all groups available to the user.
  * @returns {Array} - An array of groups.
  */
  async fetchGroups() {
    debug('Fetching groups');
    const groups = await this.api.Groups.all();

    return groups;
  }

  /**
  * Fetch more information about a specific group.
  * @param group {Object} - The group as retrieved from fetchGroups.
  * @returns {Object} - A verbose group object.
  */
  async fetchGroup(group) {
    debug(`Fetching group '${group.name}' with id ${group.id}`);
    const verboseGroup = await this.api.Groups.show(group.id);

    return verboseGroup;
  }

  /**
  * Fetch all milestones of a group.
  * @param group {Object} - The group as retrieved from fetchGroups.
  * @returns {Array} - An array of milestones.
  */
  async fetchMilestones(group) {
    debug(`Fetching milestones for group '${group.name}' with id ${group.id}`);
    const milestones = await this.api.GroupMilestones.all(group.id);

    return milestones;
  }

  /**
  * Fetch all milestone issues of a group's milestone
  * @param group {Object} - The group as retrieved from fetchGroups.
  * @param milestone {Object} - The milestone as retrieved from fetchMilestones.
  * @returns {Array} - An array of issues.
  */
  async fetchMilestoneIssues(group, milestone) {
    debug(`Fetching issues for milestone '${milestone.title}' with id ${milestone.id}`);
    const issues = await this.api.GroupMilestones.issues(group.id, milestone.id);

    return issues;
  }

  /**
  * Fetch all discussion (comments etc.) for an issue.
  * @param issue {Object} - An issue as retrieved from fetchMilestoneIssues or another compatible call.
  * @returns {Array} - An array of discussion.
  */
  async fetchIssueDiscussion(issue) {
    debug(`Fetching discussion for issue '${issue.title}' with id ${issue.id} of project with id ${issue.projectId}`);
    const discussion = await this.api.IssueDiscussions.all(issue.projectId, issue.iid);

    return discussion;
  }

  /**
  * Fetch all discussion (comments etc.) for a list of issues and add them to the issue as 'discussion'.
  * @param issues {Array} - An array of issues as retrieved from fetchMilestoneIssues or another compatible call.
  */
  async fetchAndMergeIssueDiscussions(issues) {
    debug('Fetching discussions for issues and merging them');
    await Promise.all(issues.map(async issue => {
      issue.discussion = await this.fetchIssueDiscussion(issue);
    }));
  }

  /**
  * Generate a burndown chart for a given milestone.
  * @param milestone {Object} - A milestone as retrieved from fetchMilestones.
  * @param milestoneIssues {Array} - An array of milestone issues with discussion as retrieved from fetchMilestoneIssues and fetchAndMergeDiscussions.
  * @returns {Object} - A binary buffer containing the resulting PNG image data.
  */
  async generateBurndownChart(milestone, milestoneIssues, options = {}) {
    debug(`Creating a burndown chart for milestone '${milestone.title}' with id ${milestone.id}`);

    options = {
      getEffort: issue => issue.timeStats.totalTimeSpent,
      width: 1420,
      height: 720,
      ...options
    };

    const {title, startDate, dueDate} = milestone;

    debug(`Creating a canvas of size ${options.width}x${options.height}`);
    const canvas = new CanvasRenderService(options.width, options.height, ChartJS => {
      ChartJS.defaults.global.elements.line.borderWidth = 4;
      ChartJS.defaults.global.elements.rectangle.borderWidth = 4;
      ChartJS.defaults.global.defaultFontColor = '#33333';
      ChartJS.defaults.global.defaultFontSize = 24;
      ChartJS.defaults.global.defaultFontStyle = 'Bold';
    });

    const days = Math.ceil((new Date(dueDate) - new Date(startDate)) / MILLISECONDS_IN_DAY);
    const issuesOpenedByDay = new Array(days).fill(0);
    const issuesClosedByDay = new Array(days).fill(0);
    const effortSpentByDay = new Array(days).fill(0);
    const effortEstimatedByDay = new Array(days).fill(0);

    debug(`Parsing data for milestone of ${days} days from ${milestoneIssues.length} issues`);
    for (const issue of milestoneIssues) {
      // The comment mentioning the last milestone change
      const lastMilestoneChangeComment = issue.discussion.sort((a, b) => {
        // Notes about milestones created by the system only contain one note
        const updateAtA = new Date(a.notes[0].updatedAt);
        const updateAtB = new Date(b.notes[0].updatedAt);

        // Sort by newest first
        return updateAtB - updateAtA;
      }).find(comment => {
        // Check for notes in the comment mentioning the milestone change
        return comment.notes.some(note => {
          const changedMilestone = note.body === `changed milestone to %"${milestone.title}"` || note.body === `changed milestone to %${milestone.iid}`;
          const isBySystem = note.system;

          return changedMilestone && isBySystem;
        });
      });

      // The day of the sprint where the issue was added (if added before the start date, it will be 0)
      const dayAdded = Math.max(0, Math.round((new Date(lastMilestoneChangeComment.notes[0].updatedAt) - new Date(startDate)) / MILLISECONDS_IN_DAY));

      // The day of the sprint where the issue was closed. Only valid if issue.closedAt is not null
      const dayClosed = issue.closedAt ? Math.round((new Date(issue.closedAt) - new Date(startDate)) / MILLISECONDS_IN_DAY) : null;

      // Ignore the issue if it was added after the milestone's due date
      if (dayAdded >= days)
        continue;

      // Ignore the issue if it was closed before the milestone's start date
      if (dayClosed < 0)
        continue;

      issuesOpenedByDay[dayAdded] += 1;
      effortEstimatedByDay[dayAdded] += options.getEffort(issue) || 0;

      if (dayClosed !== null && dayClosed < days) {
        issuesClosedByDay[dayClosed] += 1;

        effortSpentByDay[dayClosed] += options.getEffort(issue) || 0;
      }
    }

    const completedTasks = issuesClosedByDay;
    // Calculate the cumulative sum of each day
    const remainingEffort = new Array(days).fill(0).map((_, i) => {
      const effortEstimated = effortEstimatedByDay.slice(0, i + 1).reduce((sum, estimated) => sum + estimated, 0);
      const effortSpent = effortSpentByDay.slice(0, i + 1).reduce((sum, spent) => sum + spent, 0);
      return effortEstimated - effortSpent;
    });
    const totalEffort = effortEstimatedByDay.reduce((sum, estimated) => sum + estimated, 0);
    // The ideal burndown is the cumulative sum of the average effort for each day
    const idealBurndown = new Array(days).fill(0).map((_, i) => totalEffort - ((totalEffort / (days - 1)) * i));
    // Calculate the cumulative sum of each day
    const remainingTasks = new Array(days).fill(0).map((_, i) => {
      const issuesOpened = issuesOpenedByDay.slice(0, i + 1).reduce((sum, opened) => sum + opened, 0);
      const issuesClosed = issuesClosedByDay.slice(0, i + 1).reduce((sum, closed) => sum + closed, 0);
      return issuesOpened - issuesClosed;
    });

    const configuration = {
      type: 'line',
      data: {
        labels: new Array(days).fill(null).map((_, day) => `Day ${day + 1}`),
        datasets: [
          {
            label: 'Completed tasks',
            borderColor: '#E3AC28',
            backgroundColor: '#E3AC28',
            fill: false,
            data: completedTasks,
            yAxisID: 'y-axis-tasks',
            pointRadius: 0,
            tension: 0,
            type: 'bar'
          },
          {
            label: 'Remaining effort',
            borderColor: '#4674C1',
            backgroundColor: '#4674C1',
            fill: false,
            data: remainingEffort,
            yAxisID: 'y-axis-effort',
            pointStyle: 'rectRot',
            pointRadius: 8,
            tension: 0
          },
          {
            label: 'Ideal burndown',
            borderColor: '#558139',
            backgroundColor: '#558139',
            fill: false,
            data: idealBurndown,
            yAxisID: 'y-axis-effort',
            pointRadius: 0,
            tension: 0
          },
          {
            label: 'Remaining tasks',
            borderColor: '#9EC4E4',
            backgroundColor: '#9EC4E4',
            fill: false,
            data: remainingTasks,
            yAxisID: 'y-axis-tasks',
            pointRadius: 0,
            tension: 0
          }
        ]
      },
      options: {
        scales: {
          yAxes: [
            {
              type: 'linear',
              display: true,
              position: 'left',
              id: 'y-axis-effort',
              scaleLabel: {
                display: true,
                labelString: 'Remaining effort'
              }
            },
            {
              type: 'linear',
              display: true,
              position: 'right',
              id: 'y-axis-tasks',
              scaleLabel: {
                display: true,
                labelString: 'Remaining and completed tasks'
              }
            }
          ]
        },
        legend: {
          position: 'right'
        },
        title: {
          display: true,
          text: title
        }
      }
    };

    debug('Generating PNG image');
    const image = await canvas.renderToBuffer(configuration);
    return image;
  }
}

module.exports = GitScribe;
