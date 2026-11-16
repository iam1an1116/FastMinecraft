import { CronJob } from 'cron';
import { v4 as uuid } from 'uuid';
import { getDb } from '../../database/init.js';
import { ServerManager } from '../server/ServerManager.js';
import { BackupManager } from '../backup/BackupManager.js';

const jobs = new Map();

export class SchedulerManager {
  static list(serverId) {
    const db = getDb();
    return db.prepare('SELECT * FROM scheduled_tasks WHERE server_id = ?').all(serverId);
  }

  static create({ serverId, name, type, cronExpression, command }) {
    const db = getDb();
    const id = uuid();

    db.prepare(`
      INSERT INTO scheduled_tasks (id, server_id, name, type, cron_expression, command)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, serverId, name, type, cronExpression, command || null);

    this.scheduleJob(id, serverId, type, cronExpression, command);

    return { id, name, type, cronExpression, command };
  }

  static update(taskId, updates) {
    const db = getDb();
    const task = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(taskId);
    if (!task) throw new Error('Task not found');

    const sets = [];
    const values = [];
    for (const [key, value] of Object.entries(updates)) {
      if (['name', 'cron_expression', 'command', 'enabled'].includes(key)) {
        sets.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (sets.length > 0) {
      values.push(taskId);
      db.prepare(`UPDATE scheduled_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    }

    // Reschedule
    this.cancelJob(taskId);
    if (updates.enabled !== false) {
      const updated = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(taskId);
      this.scheduleJob(taskId, updated.server_id, updated.type, updated.cron_expression, updated.command);
    }

    return db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(taskId);
  }

  static delete(taskId) {
    this.cancelJob(taskId);
    const db = getDb();
    db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(taskId);
    return { deleted: true };
  }

  static scheduleJob(id, serverId, type, cronExpression, command) {
    try {
      const job = new CronJob(cronExpression, async () => {
        try {
          if (type === 'restart') {
            await ServerManager.restart(serverId);
          } else if (type === 'backup') {
            BackupManager.create(serverId, 'full');
          } else if (type === 'command' && command) {
            ServerManager.sendCommand(serverId, command);
          }
        } catch (err) {
          console.error(`Scheduled task ${id} failed:`, err);
        }
      });
      job.start();
      jobs.set(id, job);
    } catch (err) {
      console.error(`Failed to schedule task ${id}:`, err);
    }
  }

  static cancelJob(id) {
    const job = jobs.get(id);
    if (job) {
      job.stop();
      jobs.delete(id);
    }
  }

  static initAll() {
    const db = getDb();
    const tasks = db.prepare('SELECT * FROM scheduled_tasks WHERE enabled = 1').all();
    for (const task of tasks) {
      this.scheduleJob(task.id, task.server_id, task.type, task.cron_expression, task.command);
    }
  }
}
