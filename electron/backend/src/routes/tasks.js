import { Router } from 'express';
import { SchedulerManager } from '../modules/scheduler/SchedulerManager.js';

const router = Router();

// List tasks
router.get('/:id/tasks', (req, res) => {
  const tasks = SchedulerManager.list(req.params.id);
  res.json(tasks);
});

// Create task
router.post('/:id/tasks', (req, res) => {
  try {
    const { name, type, cronExpression, command } = req.body;
    if (!name || !type || !cronExpression) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const task = SchedulerManager.create({
      serverId: req.params.id,
      name,
      type,
      cronExpression,
      command
    });
    res.status(201).json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update task
router.patch('/:id/tasks/:tid', (req, res) => {
  try {
    const task = SchedulerManager.update(req.params.tid, req.body);
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete task
router.delete('/:id/tasks/:tid', (req, res) => {
  try {
    SchedulerManager.delete(req.params.tid);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export { router as taskRoutes };
