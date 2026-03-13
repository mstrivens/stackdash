import React from 'react';
import type { DashboardStats } from '../types';

interface StatsColumnProps {
  stats: DashboardStats;
  lastUpdated: string | null;
}

export function StatsColumn({ stats, lastUpdated }: StatsColumnProps) {
  const total = stats.highPriorityCount + stats.mediumPriorityCount + stats.lowPriorityCount;

  const getBarWidth = (count: number) => {
    if (total === 0) return '0%';
    return `${(count / total) * 100}%`;
  };

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatLastUpdated = (timestamp: string | null) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="stats-column">
      <h2 className="stats-title">Dashboard Stats</h2>

      <div className="stat-group">
        <div className="stat-item">
          <span className="stat-label">Total Issues</span>
          <span className="stat-value">{stats.totalIssues}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Pending Triage</span>
          <span className="stat-value" style={{ color: 'var(--text-muted)' }}>
            {stats.pendingTriageCount}
          </span>
        </div>
        {stats.failedTriageCount > 0 && (
          <div className="stat-item">
            <span className="stat-label">Failed Triage</span>
            <span className="stat-value" style={{ color: 'var(--high-priority)' }}>
              {stats.failedTriageCount}
            </span>
          </div>
        )}
      </div>

      <div className="stat-group">
        <div className="stat-item">
          <span className="stat-label">High Priority</span>
          <span className="stat-value high">{stats.highPriorityCount}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Medium Priority</span>
          <span className="stat-value medium">{stats.mediumPriorityCount}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Low Priority</span>
          <span className="stat-value low">{stats.lowPriorityCount}</span>
        </div>

        {total > 0 && (
          <div className="priority-distribution">
            <div
              className="priority-bar high"
              style={{ width: getBarWidth(stats.highPriorityCount) }}
            />
            <div
              className="priority-bar medium"
              style={{ width: getBarWidth(stats.mediumPriorityCount) }}
            />
            <div
              className="priority-bar low"
              style={{ width: getBarWidth(stats.lowPriorityCount) }}
            />
          </div>
        )}
      </div>

      <div className="stat-group">
        <div className="stat-item">
          <span className="stat-label">Avg Triage Time</span>
          <span className="stat-value" style={{ fontSize: '1rem' }}>
            {stats.avgTriageTime > 0 ? formatTime(stats.avgTriageTime) : '—'}
          </span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Recent Activity</span>
          <span className="stat-value" style={{ fontSize: '1rem' }}>
            {stats.recentActivityCount} issues
          </span>
        </div>
      </div>

      <div className="stat-group" style={{ marginTop: 'auto' }}>
        <div className="stat-item">
          <span className="stat-label">Last Updated</span>
          <span className="stat-value" style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            {formatLastUpdated(lastUpdated)}
          </span>
        </div>
      </div>
    </div>
  );
}
