const { ipcMain } = require('electron');
const store = require('../store/jsonStore');
const logger = require('../services/logger');
const hermesService = require('../services/hermesService');

/**
 * Registers IPC handlers for task scheduling and management.
 */
function registerTaskHandlers() {
  /**
   * Schedules a new task.
   */
  ipcMain.handle('schedule-task', (event, { description, time }) => {
    if (!description || !time) {
      return { success: false, error: "Missing description or time" };
    }

    const newTask = { 
      id: Date.now().toString(), 
      description, 
      time, 
      completed: false,
      createdAt: new Date().toISOString()
    };
    
    const tasks = store.getTasks();
    tasks.push(newTask);
    store.saveTasks(tasks);
    const settings = store.getSettings();
    if (settings?.hermes?.autoForwardTasksPersonas) {
      hermesService.syncLocalContext().catch(error => {
        logger.error('HERMES', 'task sync error', error);
      });
    }
    
    return { success: true, data: newTask };
  });

  /**
   * Retrieves pending (uncompleted) tasks.
   */
  ipcMain.handle('get-tasks', () => {
    return { success: true, data: store.getTasks().filter(t => !t.completed) };
  });

  /**
   * Deletes a task by ID.
   */
  ipcMain.handle('delete-task', (event, id) => {
    if (!id) return { success: false, error: "Missing ID" };
    const tasks = store.getTasks().filter(t => t.id !== id);
    store.saveTasks(tasks);
    const settings = store.getSettings();
    if (settings?.hermes?.autoForwardTasksPersonas) {
      hermesService.syncLocalContext().catch(error => {
        logger.error('HERMES', 'task sync error', error);
      });
    }
    return { success: true };
  });
}

module.exports = registerTaskHandlers;
