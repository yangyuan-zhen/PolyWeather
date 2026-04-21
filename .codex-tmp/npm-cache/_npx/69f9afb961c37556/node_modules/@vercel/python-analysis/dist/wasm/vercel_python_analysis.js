export function instantiate(getCoreModule, imports, instantiateCore = WebAssembly.instantiate) {
  
  let dv = new DataView(new ArrayBuffer());
  const dataView = mem => dv.buffer === mem.buffer ? dv : dv = new DataView(mem.buffer);
  
  const toUint64 = val => BigInt.asUintN(64, BigInt(val));
  
  function toUint16(val) {
    val >>>= 0;
    val %= 2 ** 16;
    return val;
  }
  
  function toUint32(val) {
    return val >>> 0;
  }
  
  function toUint8(val) {
    val >>>= 0;
    val %= 2 ** 8;
    return val;
  }
  
  const utf8Decoder = new TextDecoder();
  
  const utf8Encoder = new TextEncoder();
  let utf8EncodedLen = 0;
  function utf8Encode(s, realloc, memory) {
    if (typeof s !== 'string') throw new TypeError('expected a string');
    if (s.length === 0) {
      utf8EncodedLen = 0;
      return 1;
    }
    let buf = utf8Encoder.encode(s);
    let ptr = realloc(0, 0, 1, buf.length);
    new Uint8Array(memory.buffer).set(buf, ptr);
    utf8EncodedLen = buf.length;
    return ptr;
  }
  
  const T_FLAG = 1 << 30;
  
  function rscTableCreateOwn (table, rep) {
    const free = table[0] & ~T_FLAG;
    if (free === 0) {
      table.push(0);
      table.push(rep | T_FLAG);
      return (table.length >> 1) - 1;
    }
    table[0] = table[free << 1];
    table[free << 1] = 0;
    table[(free << 1) + 1] = rep | T_FLAG;
    return free;
  }
  
  function rscTableRemove (table, handle) {
    const scope = table[handle << 1];
    const val = table[(handle << 1) + 1];
    const own = (val & T_FLAG) !== 0;
    const rep = val & ~T_FLAG;
    if (val === 0 || (scope & T_FLAG) !== 0) throw new TypeError('Invalid handle');
    table[handle << 1] = table[0] | T_FLAG;
    table[0] = handle | T_FLAG;
    return { rep, scope, own };
  }
  
  let curResourceBorrows = [];
  
  let NEXT_TASK_ID = 0n;
  function startCurrentTask(componentIdx, isAsync, entryFnName) {
    _debugLog('[startCurrentTask()] args', { componentIdx, isAsync });
    if (componentIdx === undefined || componentIdx === null) {
      throw new Error('missing/invalid component instance index while starting task');
    }
    const tasks = ASYNC_TASKS_BY_COMPONENT_IDX.get(componentIdx);
    
    const nextId = ++NEXT_TASK_ID;
    const newTask = new AsyncTask({ id: nextId, componentIdx, isAsync, entryFnName });
    const newTaskMeta = { id: nextId, componentIdx, task: newTask };
    
    ASYNC_CURRENT_TASK_IDS.push(nextId);
    ASYNC_CURRENT_COMPONENT_IDXS.push(componentIdx);
    
    if (!tasks) {
      ASYNC_TASKS_BY_COMPONENT_IDX.set(componentIdx, [newTaskMeta]);
      return nextId;
    } else {
      tasks.push(newTaskMeta);
    }
    
    return nextId;
  }
  
  function endCurrentTask(componentIdx, taskId) {
    _debugLog('[endCurrentTask()] args', { componentIdx });
    componentIdx ??= ASYNC_CURRENT_COMPONENT_IDXS.at(-1);
    taskId ??= ASYNC_CURRENT_TASK_IDS.at(-1);
    if (componentIdx === undefined || componentIdx === null) {
      throw new Error('missing/invalid component instance index while ending current task');
    }
    const tasks = ASYNC_TASKS_BY_COMPONENT_IDX.get(componentIdx);
    if (!tasks || !Array.isArray(tasks)) {
      throw new Error('missing/invalid tasks for component instance while ending task');
    }
    if (tasks.length == 0) {
      throw new Error('no current task(s) for component instance while ending task');
    }
    
    if (taskId) {
      const last = tasks[tasks.length - 1];
      if (last.id !== taskId) {
        throw new Error('current task does not match expected task ID');
      }
    }
    
    ASYNC_CURRENT_TASK_IDS.pop();
    ASYNC_CURRENT_COMPONENT_IDXS.pop();
    
    return tasks.pop();
  }
  const ASYNC_TASKS_BY_COMPONENT_IDX = new Map();
  const ASYNC_CURRENT_TASK_IDS = [];
  const ASYNC_CURRENT_COMPONENT_IDXS = [];
  
  class AsyncTask {
    static State = {
      INITIAL: 'initial',
      CANCELLED: 'cancelled',
      CANCEL_PENDING: 'cancel-pending',
      CANCEL_DELIVERED: 'cancel-delivered',
      RESOLVED: 'resolved',
    }
    
    static BlockResult = {
      CANCELLED: 'block.cancelled',
      NOT_CANCELLED: 'block.not-cancelled',
    }
    
    #id;
    #componentIdx;
    #state;
    #isAsync;
    #onResolve = null;
    #entryFnName = null;
    #subtasks = [];
    #completionPromise = null;
    
    cancelled = false;
    requested = false;
    alwaysTaskReturn = false;
    
    returnCalls =  0;
    storage = [0, 0];
    borrowedHandles = {};
    
    awaitableResume = null;
    awaitableCancel = null;
    
    
    constructor(opts) {
      if (opts?.id === undefined) { throw new TypeError('missing task ID during task creation'); }
      this.#id = opts.id;
      if (opts?.componentIdx === undefined) {
        throw new TypeError('missing component id during task creation');
      }
      this.#componentIdx = opts.componentIdx;
      this.#state = AsyncTask.State.INITIAL;
      this.#isAsync = opts?.isAsync ?? false;
      this.#entryFnName = opts.entryFnName;
      
      const {
        promise: completionPromise,
        resolve: resolveCompletionPromise,
        reject: rejectCompletionPromise,
      } = Promise.withResolvers();
      this.#completionPromise = completionPromise;
      
      this.#onResolve = (results) => {
        // TODO: handle external facing cancellation (should likely be a rejection)
        resolveCompletionPromise(results);
      }
    }
    
    taskState() { return this.#state.slice(); }
    id() { return this.#id; }
    componentIdx() { return this.#componentIdx; }
    isAsync() { return this.#isAsync; }
    entryFnName() { return this.#entryFnName; }
    completionPromise() { return this.#completionPromise; }
    
    mayEnter(task) {
      const cstate = getOrCreateAsyncState(this.#componentIdx);
      if (!cstate.backpressure) {
        _debugLog('[AsyncTask#mayEnter()] disallowed due to backpressure', { taskID: this.#id });
        return false;
      }
      if (!cstate.callingSyncImport()) {
        _debugLog('[AsyncTask#mayEnter()] disallowed due to sync import call', { taskID: this.#id });
        return false;
      }
      const callingSyncExportWithSyncPending = cstate.callingSyncExport && !task.isAsync;
      if (!callingSyncExportWithSyncPending) {
        _debugLog('[AsyncTask#mayEnter()] disallowed due to sync export w/ sync pending', { taskID: this.#id });
        return false;
      }
      return true;
    }
    
    async enter() {
      _debugLog('[AsyncTask#enter()] args', { taskID: this.#id });
      
      // TODO: assert scheduler locked
      // TODO: trap if on the stack
      
      const cstate = getOrCreateAsyncState(this.#componentIdx);
      
      let mayNotEnter = !this.mayEnter(this);
      const componentHasPendingTasks = cstate.pendingTasks > 0;
      if (mayNotEnter || componentHasPendingTasks) {
        throw new Error('in enter()'); // TODO: remove
        cstate.pendingTasks.set(this.#id, new Awaitable(new Promise()));
        
        const blockResult = await this.onBlock(awaitable);
        if (blockResult) {
          // TODO: find this pending task in the component
          const pendingTask = cstate.pendingTasks.get(this.#id);
          if (!pendingTask) {
            throw new Error('pending task [' + this.#id + '] not found for component instance');
          }
          cstate.pendingTasks.remove(this.#id);
          this.#onResolve(new Error('failed enter'));
          return false;
        }
        
        mayNotEnter = !this.mayEnter(this);
        if (!mayNotEnter || !cstate.startPendingTask) {
          throw new Error('invalid component entrance/pending task resolution');
        }
        cstate.startPendingTask = false;
      }
      
      if (!this.isAsync) { cstate.callingSyncExport = true; }
      
      return true;
    }
    
    async waitForEvent(opts) {
      const { waitableSetRep, isAsync } = opts;
      _debugLog('[AsyncTask#waitForEvent()] args', { taskID: this.#id, waitableSetRep, isAsync });
      
      if (this.#isAsync !== isAsync) {
        throw new Error('async waitForEvent called on non-async task');
      }
      
      if (this.status === AsyncTask.State.CANCEL_PENDING) {
        this.#state = AsyncTask.State.CANCEL_DELIVERED;
        return {
          code: ASYNC_EVENT_CODE.TASK_CANCELLED,
        };
      }
      
      const state = getOrCreateAsyncState(this.#componentIdx);
      const waitableSet = state.waitableSets.get(waitableSetRep);
      if (!waitableSet) { throw new Error('missing/invalid waitable set'); }
      
      waitableSet.numWaiting += 1;
      let event = null;
      
      while (event == null) {
        const awaitable = new Awaitable(waitableSet.getPendingEvent());
        const waited = await this.blockOn({ awaitable, isAsync, isCancellable: true });
        if (waited) {
          if (this.#state !== AsyncTask.State.INITIAL) {
            throw new Error('task should be in initial state found [' + this.#state + ']');
          }
          this.#state = AsyncTask.State.CANCELLED;
          return {
            code: ASYNC_EVENT_CODE.TASK_CANCELLED,
          };
        }
        
        event = waitableSet.poll();
      }
      
      waitableSet.numWaiting -= 1;
      return event;
    }
    
    waitForEventSync(opts) {
      throw new Error('AsyncTask#yieldSync() not implemented')
    }
    
    async pollForEvent(opts) {
      const { waitableSetRep, isAsync } = opts;
      _debugLog('[AsyncTask#pollForEvent()] args', { taskID: this.#id, waitableSetRep, isAsync });
      
      if (this.#isAsync !== isAsync) {
        throw new Error('async pollForEvent called on non-async task');
      }
      
      throw new Error('AsyncTask#pollForEvent() not implemented');
    }
    
    pollForEventSync(opts) {
      throw new Error('AsyncTask#yieldSync() not implemented')
    }
    
    async blockOn(opts) {
      const { awaitable, isCancellable, forCallback } = opts;
      _debugLog('[AsyncTask#blockOn()] args', { taskID: this.#id, awaitable, isCancellable, forCallback });
      
      if (awaitable.resolved() && !ASYNC_DETERMINISM && _coinFlip()) {
        return AsyncTask.BlockResult.NOT_CANCELLED;
      }
      
      const cstate = getOrCreateAsyncState(this.#componentIdx);
      if (forCallback) { cstate.exclusiveRelease(); }
      
      let cancelled = await this.onBlock(awaitable);
      if (cancelled === AsyncTask.BlockResult.CANCELLED && !isCancellable) {
        const secondCancel = await this.onBlock(awaitable);
        if (secondCancel !== AsyncTask.BlockResult.NOT_CANCELLED) {
          throw new Error('uncancellable task was canceled despite second onBlock()');
        }
      }
      
      if (forCallback) {
        const acquired = new Awaitable(cstate.exclusiveLock());
        cancelled = await this.onBlock(acquired);
        if (cancelled === AsyncTask.BlockResult.CANCELLED) {
          const secondCancel = await this.onBlock(acquired);
          if (secondCancel !== AsyncTask.BlockResult.NOT_CANCELLED) {
            throw new Error('uncancellable callback task was canceled despite second onBlock()');
          }
        }
      }
      
      if (cancelled === AsyncTask.BlockResult.CANCELLED) {
        if (this.#state !== AsyncTask.State.INITIAL) {
          throw new Error('cancelled task is not at initial state');
        }
        if (isCancellable) {
          this.#state = AsyncTask.State.CANCELLED;
          return AsyncTask.BlockResult.CANCELLED;
        } else {
          this.#state = AsyncTask.State.CANCEL_PENDING;
          return AsyncTask.BlockResult.NOT_CANCELLED;
        }
      }
      
      return AsyncTask.BlockResult.NOT_CANCELLED;
    }
    
    async onBlock(awaitable) {
      _debugLog('[AsyncTask#onBlock()] args', { taskID: this.#id, awaitable });
      if (!(awaitable instanceof Awaitable)) {
        throw new Error('invalid awaitable during onBlock');
      }
      
      // Build a promise that this task can await on which resolves when it is awoken
      const { promise, resolve, reject } = Promise.withResolvers();
      this.awaitableResume = () => {
        _debugLog('[AsyncTask] resuming after onBlock', { taskID: this.#id });
        resolve();
      };
      this.awaitableCancel = (err) => {
        _debugLog('[AsyncTask] rejecting after onBlock', { taskID: this.#id, err });
        reject(err);
      };
      
      // Park this task/execution to be handled later
      const state = getOrCreateAsyncState(this.#componentIdx);
      state.parkTaskOnAwaitable({ awaitable, task: this });
      
      try {
        await promise;
        return AsyncTask.BlockResult.NOT_CANCELLED;
      } catch (err) {
        // rejection means task cancellation
        return AsyncTask.BlockResult.CANCELLED;
      }
    }
    
    async asyncOnBlock(awaitable) {
      _debugLog('[AsyncTask#asyncOnBlock()] args', { taskID: this.#id, awaitable });
      if (!(awaitable instanceof Awaitable)) {
        throw new Error('invalid awaitable during onBlock');
      }
      // TODO: watch for waitable AND cancellation
      // TODO: if it WAS cancelled:
      // - return true
      // - only once per subtask
      // - do not wait on the scheduler
      // - control flow should go to the subtask (only once)
      // - Once subtask blocks/resolves, reqlinquishControl() will tehn resolve request_cancel_end (without scheduler lock release)
      // - control flow goes back to request_cancel
      //
      // Subtask cancellation should work similarly to an async import call -- runs sync up until
      // the subtask blocks or resolves
      //
      throw new Error('AsyncTask#asyncOnBlock() not yet implemented');
    }
    
    async yield(opts) {
      const { isCancellable, forCallback } = opts;
      _debugLog('[AsyncTask#yield()] args', { taskID: this.#id, isCancellable, forCallback });
      
      if (isCancellable && this.status === AsyncTask.State.CANCEL_PENDING) {
        this.#state = AsyncTask.State.CANCELLED;
        return {
          code: ASYNC_EVENT_CODE.TASK_CANCELLED,
          payload: [0, 0],
        };
      }
      
      // TODO: Awaitables need to *always* trigger the parking mechanism when they're done...?
      // TODO: Component async state should remember which awaitables are done and work to clear tasks waiting
      
      const blockResult = await this.blockOn({
        awaitable: new Awaitable(new Promise(resolve => setTimeout(resolve, 0))),
        isCancellable,
        forCallback,
      });
      
      if (blockResult === AsyncTask.BlockResult.CANCELLED) {
        if (this.#state !== AsyncTask.State.INITIAL) {
          throw new Error('task should be in initial state found [' + this.#state + ']');
        }
        this.#state = AsyncTask.State.CANCELLED;
        return {
          code: ASYNC_EVENT_CODE.TASK_CANCELLED,
          payload: [0, 0],
        };
      }
      
      return {
        code: ASYNC_EVENT_CODE.NONE,
        payload: [0, 0],
      };
    }
    
    yieldSync(opts) {
      throw new Error('AsyncTask#yieldSync() not implemented')
    }
    
    cancel() {
      _debugLog('[AsyncTask#cancel()] args', { });
      if (!this.taskState() !== AsyncTask.State.CANCEL_DELIVERED) {
        throw new Error('invalid task state for cancellation');
      }
      if (this.borrowedHandles.length > 0) { throw new Error('task still has borrow handles'); }
      
      this.#onResolve(new Error('cancelled'));
      this.#state = AsyncTask.State.RESOLVED;
    }
    
    resolve(results) {
      _debugLog('[AsyncTask#resolve()] args', { results });
      if (this.#state === AsyncTask.State.RESOLVED) {
        throw new Error('task is already resolved');
      }
      if (this.borrowedHandles.length > 0) { throw new Error('task still has borrow handles'); }
      this.#onResolve(results.length === 1 ? results[0] : results);
      this.#state = AsyncTask.State.RESOLVED;
    }
    
    exit() {
      _debugLog('[AsyncTask#exit()] args', { });
      
      // TODO: ensure there is only one task at a time (scheduler.lock() functionality)
      if (this.#state !== AsyncTask.State.RESOLVED) {
        throw new Error('task exited without resolution');
      }
      if (this.borrowedHandles > 0) {
        throw new Error('task exited without clearing borrowed handles');
      }
      
      const state = getOrCreateAsyncState(this.#componentIdx);
      if (!state) { throw new Error('missing async state for component [' + this.#componentIdx + ']'); }
      if (!this.#isAsync && !state.inSyncExportCall) {
        throw new Error('sync task must be run from components known to be in a sync export call');
      }
      state.inSyncExportCall = false;
      
      this.startPendingTask();
    }
    
    startPendingTask(args) {
      _debugLog('[AsyncTask#startPendingTask()] args', args);
      throw new Error('AsyncTask#startPendingTask() not implemented');
    }
    
    createSubtask(args) {
      _debugLog('[AsyncTask#createSubtask()] args', args);
      const newSubtask = new AsyncSubtask({
        componentIdx: this.componentIdx(),
        taskID: this.id(),
        memoryIdx: args?.memoryIdx,
      });
      this.#subtasks.push(newSubtask);
      return newSubtask;
    }
    
    currentSubtask() {
      _debugLog('[AsyncTask#currentSubtask()]');
      if (this.#subtasks.length === 0) { throw new Error('no current subtask'); }
      return this.#subtasks.at(-1);
    }
    
    endCurrentSubtask() {
      _debugLog('[AsyncTask#endCurrentSubtask()]');
      if (this.#subtasks.length === 0) { throw new Error('cannot end current subtask: no current subtask'); }
      const subtask = this.#subtasks.pop();
      subtask.drop();
      return subtask;
    }
  }
  
  function unpackCallbackResult(result) {
    _debugLog('[unpackCallbackResult()] args', { result });
    if (!(_typeCheckValidI32(result))) { throw new Error('invalid callback return value [' + result + '], not a valid i32'); }
    const eventCode = result & 0xF;
    if (eventCode < 0 || eventCode > 3) {
      throw new Error('invalid async return value [' + eventCode + '], outside callback code range');
    }
    if (result < 0 || result >= 2**32) { throw new Error('invalid callback result'); }
    // TODO: table max length check?
    const waitableSetIdx = result >> 4;
    return [eventCode, waitableSetIdx];
  }
  const ASYNC_STATE = new Map();
  
  function getOrCreateAsyncState(componentIdx, init) {
    if (!ASYNC_STATE.has(componentIdx)) {
      ASYNC_STATE.set(componentIdx, new ComponentAsyncState());
    }
    return ASYNC_STATE.get(componentIdx);
  }
  
  class ComponentAsyncState {
    #callingAsyncImport = false;
    #syncImportWait = Promise.withResolvers();
    #lock = null;
    
    mayLeave = true;
    waitableSets = new RepTable();
    waitables = new RepTable();
    
    #parkedTasks = new Map();
    
    callingSyncImport(val) {
      if (val === undefined) { return this.#callingAsyncImport; }
      if (typeof val !== 'boolean') { throw new TypeError('invalid setting for async import'); }
      const prev = this.#callingAsyncImport;
      this.#callingAsyncImport = val;
      if (prev === true && this.#callingAsyncImport === false) {
        this.#notifySyncImportEnd();
      }
    }
    
    #notifySyncImportEnd() {
      const existing = this.#syncImportWait;
      this.#syncImportWait = Promise.withResolvers();
      existing.resolve();
    }
    
    async waitForSyncImportCallEnd() {
      await this.#syncImportWait.promise;
    }
    
    parkTaskOnAwaitable(args) {
      if (!args.awaitable) { throw new TypeError('missing awaitable when trying to park'); }
      if (!args.task) { throw new TypeError('missing task when trying to park'); }
      const { awaitable, task } = args;
      
      let taskList = this.#parkedTasks.get(awaitable.id());
      if (!taskList) {
        taskList = [];
        this.#parkedTasks.set(awaitable.id(), taskList);
      }
      taskList.push(task);
      
      this.wakeNextTaskForAwaitable(awaitable);
    }
    
    wakeNextTaskForAwaitable(awaitable) {
      if (!awaitable) { throw new TypeError('missing awaitable when waking next task'); }
      const awaitableID = awaitable.id();
      
      const taskList = this.#parkedTasks.get(awaitableID);
      if (!taskList || taskList.length === 0) {
        _debugLog('[ComponentAsyncState] no tasks waiting for awaitable', { awaitableID: awaitable.id() });
        return;
      }
      
      let task = taskList.shift(); // todo(perf)
      if (!task) { throw new Error('no task in parked list despite previous check'); }
      
      if (!task.awaitableResume) {
        throw new Error('task ready due to awaitable is missing resume', { taskID: task.id(), awaitableID });
      }
      task.awaitableResume();
    }
    
    async exclusiveLock() {  // TODO: use atomics
    if (this.#lock === null) {
      this.#lock = { ticket: 0n };
    }
    
    // Take a ticket for the next valid usage
    const ticket = ++this.#lock.ticket;
    
    _debugLog('[ComponentAsyncState#exclusiveLock()] locking', {
      currentTicket: ticket - 1n,
      ticket
    });
    
    // If there is an active promise, then wait for it
    let finishedTicket;
    while (this.#lock.promise) {
      finishedTicket = await this.#lock.promise;
      if (finishedTicket === ticket - 1n) { break; }
    }
    
    const { promise, resolve } = Promise.withResolvers();
    this.#lock = {
      ticket,
      promise,
      resolve,
    };
    
    return this.#lock.promise;
  }
  
  exclusiveRelease() {
    _debugLog('[ComponentAsyncState#exclusiveRelease()] releasing', {
      currentTicket: this.#lock === null ? 'none' : this.#lock.ticket,
    });
    
    if (this.#lock === null) { return; }
    
    const existingLock = this.#lock;
    this.#lock = null;
    existingLock.resolve(existingLock.ticket);
  }
  
  isExclusivelyLocked() { return this.#lock !== null; }
  
}

function prepareCall(memoryIdx) {
  _debugLog('[prepareCall()] args', { memoryIdx });
  
  const taskMeta = getCurrentTask(ASYNC_CURRENT_COMPONENT_IDXS.at(-1), ASYNC_CURRENT_TASK_IDS.at(-1));
  if (!taskMeta) { throw new Error('invalid/missing current async task meta during prepare call'); }
  
  const task = taskMeta.task;
  if (!task) { throw new Error('unexpectedly missing task in task meta during prepare call'); }
  
  const state = getOrCreateAsyncState(task.componentIdx());
  if (!state) {
    throw new Error('invalid/missing async state for component instance [' + componentInstanceID + ']');
  }
  
  const subtask = task.createSubtask({
    memoryIdx,
  });
  
}

function asyncStartCall(callbackIdx, postReturnIdx) {
  _debugLog('[asyncStartCall()] args', { callbackIdx, postReturnIdx });
  
  const taskMeta = getCurrentTask(ASYNC_CURRENT_COMPONENT_IDXS.at(-1), ASYNC_CURRENT_TASK_IDS.at(-1));
  if (!taskMeta) { throw new Error('invalid/missing current async task meta during prepare call'); }
  
  const task = taskMeta.task;
  if (!task) { throw new Error('unexpectedly missing task in task meta during prepare call'); }
  
  const subtask = task.currentSubtask();
  if (!subtask) { throw new Error('invalid/missing subtask during async start call'); }
  
  return Number(subtask.waitableRep()) << 4 | subtask.getStateNumber();
}

function syncStartCall(callbackIdx) {
  _debugLog('[syncStartCall()] args', { callbackIdx });
}

if (!Promise.withResolvers) {
  Promise.withResolvers = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

const _debugLog = (...args) => {
  if (!globalThis?.process?.env?.JCO_DEBUG) { return; }
  console.debug(...args);
}
const ASYNC_DETERMINISM = 'random';
const _coinFlip = () => { return Math.random() > 0.5; };
const I32_MAX = 2_147_483_647;
const I32_MIN = -2_147_483_648;
const _typeCheckValidI32 = (n) => typeof n === 'number' && n >= I32_MIN && n <= I32_MAX;

const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
let _fs;
async function fetchCompile (url) {
  if (isNode) {
    _fs = _fs || await import('node:fs/promises');
    return WebAssembly.compile(await _fs.readFile(url));
  }
  return fetch(url).then(WebAssembly.compileStreaming);
}

const symbolCabiDispose = Symbol.for('cabiDispose');

const symbolRscHandle = Symbol('handle');

const symbolRscRep = Symbol.for('cabiRep');

const symbolDispose = Symbol.dispose || Symbol.for('dispose');

const handleTables = [];

class ComponentError extends Error {
  constructor (value) {
    const enumerable = typeof value !== 'string';
    super(enumerable ? `${String(value)} (see error.payload)` : value);
    Object.defineProperty(this, 'payload', { value, enumerable });
  }
}

function getErrorPayload(e) {
  if (e && hasOwnProperty.call(e, 'payload')) return e.payload;
  if (e instanceof Error) throw e;
  return e;
}

class RepTable {
  #data = [0, null];
  
  insert(val) {
    _debugLog('[RepTable#insert()] args', { val });
    const freeIdx = this.#data[0];
    if (freeIdx === 0) {
      this.#data.push(val);
      this.#data.push(null);
      return (this.#data.length >> 1) - 1;
    }
    this.#data[0] = this.#data[freeIdx << 1];
    const placementIdx = freeIdx << 1;
    this.#data[placementIdx] = val;
    this.#data[placementIdx + 1] = null;
    return freeIdx;
  }
  
  get(rep) {
    _debugLog('[RepTable#get()] args', { rep });
    const baseIdx = rep << 1;
    const val = this.#data[baseIdx];
    return val;
  }
  
  contains(rep) {
    _debugLog('[RepTable#contains()] args', { rep });
    const baseIdx = rep << 1;
    return !!this.#data[baseIdx];
  }
  
  remove(rep) {
    _debugLog('[RepTable#remove()] args', { rep });
    if (this.#data.length === 2) { throw new Error('invalid'); }
    
    const baseIdx = rep << 1;
    const val = this.#data[baseIdx];
    if (val === 0) { throw new Error('invalid resource rep (cannot be 0)'); }
    
    this.#data[baseIdx] = this.#data[0];
    this.#data[0] = rep;
    
    return val;
  }
  
  clear() {
    _debugLog('[RepTable#clear()] args', { rep });
    this.#data = [0, null];
  }
}

function throwInvalidBool() {
  throw new TypeError('invalid variant discriminant for bool');
}

const hasOwnProperty = Object.prototype.hasOwnProperty;


if (!getCoreModule) getCoreModule = (name) => fetchCompile(new URL(`./${name}`, import.meta.url));
const module0 = getCoreModule('vercel_python_analysis.core.wasm');
const module1 = getCoreModule('vercel_python_analysis.core2.wasm');
const module2 = getCoreModule('vercel_python_analysis.core3.wasm');

const { domainToAscii, nfkcNormalize, readFile } = imports['vercel:python-analysis/host-utils'];
const { getEnvironment } = imports['wasi:cli/environment'];
const { exit } = imports['wasi:cli/exit'];
const { getStderr } = imports['wasi:cli/stderr'];
const { getStdin } = imports['wasi:cli/stdin'];
const { getStdout } = imports['wasi:cli/stdout'];
const { TerminalInput } = imports['wasi:cli/terminal-input'];
const { TerminalOutput } = imports['wasi:cli/terminal-output'];
const { getTerminalStderr } = imports['wasi:cli/terminal-stderr'];
const { getTerminalStdin } = imports['wasi:cli/terminal-stdin'];
const { getTerminalStdout } = imports['wasi:cli/terminal-stdout'];
const { getDirectories } = imports['wasi:filesystem/preopens'];
const { Descriptor } = imports['wasi:filesystem/types'];
const { Error: Error$1 } = imports['wasi:io/error'];
const { Pollable } = imports['wasi:io/poll'];
const { InputStream, OutputStream } = imports['wasi:io/streams'];
const { insecureSeed } = imports['wasi:random/insecure-seed'];
let gen = (function* _initGenerator () {
  let exports0;
  
  function trampoline7(arg0) {
    let variant0;
    switch (arg0) {
      case 0: {
        variant0= {
          tag: 'ok',
          val: undefined
        };
        break;
      }
      case 1: {
        variant0= {
          tag: 'err',
          val: undefined
        };
        break;
      }
      default: {
        throw new TypeError('invalid variant discriminant for expected');
      }
    }
    _debugLog('[iface="wasi:cli/exit@0.2.6", function="exit"] [Instruction::CallInterface] (async? sync, @ enter)');
    const _interface_call_currentTaskID = startCurrentTask(0, false, 'exit');
    exit(variant0);
    _debugLog('[iface="wasi:cli/exit@0.2.6", function="exit"] [Instruction::CallInterface] (sync, @ post-call)');
    endCurrentTask(0);
    _debugLog('[iface="wasi:cli/exit@0.2.6", function="exit"][Instruction::Return]', {
      funcName: 'exit',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  const handleTable0 = [T_FLAG, 0];
  const captureTable0= new Map();
  let captureCnt0 = 0;
  handleTables[0] = handleTable0;
  
  function trampoline8(arg0) {
    var handle1 = arg0;
    var rep2 = handleTable0[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable0.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Pollable.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:io/poll@0.2.6", function="[method]pollable.block"] [Instruction::CallInterface] (async? sync, @ enter)');
    const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]pollable.block');
    rsc0.block();
    _debugLog('[iface="wasi:io/poll@0.2.6", function="[method]pollable.block"] [Instruction::CallInterface] (sync, @ post-call)');
    for (const rsc of curResourceBorrows) {
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    endCurrentTask(0);
    _debugLog('[iface="wasi:io/poll@0.2.6", function="[method]pollable.block"][Instruction::Return]', {
      funcName: '[method]pollable.block',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  const handleTable3 = [T_FLAG, 0];
  const captureTable3= new Map();
  let captureCnt3 = 0;
  handleTables[3] = handleTable3;
  
  function trampoline9(arg0) {
    var handle1 = arg0;
    var rep2 = handleTable3[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable3.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(OutputStream.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:io/streams@0.2.6", function="[method]output-stream.subscribe"] [Instruction::CallInterface] (async? sync, @ enter)');
    const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]output-stream.subscribe');
    const ret = rsc0.subscribe();
    _debugLog('[iface="wasi:io/streams@0.2.6", function="[method]output-stream.subscribe"] [Instruction::CallInterface] (sync, @ post-call)');
    for (const rsc of curResourceBorrows) {
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    endCurrentTask(0);
    if (!(ret instanceof Pollable)) {
      throw new TypeError('Resource error: Not a valid "Pollable" resource.');
    }
    var handle3 = ret[symbolRscHandle];
    if (!handle3) {
      const rep = ret[symbolRscRep] || ++captureCnt0;
      captureTable0.set(rep, ret);
      handle3 = rscTableCreateOwn(handleTable0, rep);
    }
    _debugLog('[iface="wasi:io/streams@0.2.6", function="[method]output-stream.subscribe"][Instruction::Return]', {
      funcName: '[method]output-stream.subscribe',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    return handle3;
  }
  
  const handleTable2 = [T_FLAG, 0];
  const captureTable2= new Map();
  let captureCnt2 = 0;
  handleTables[2] = handleTable2;
  
  function trampoline10() {
    _debugLog('[iface="wasi:cli/stdin@0.2.6", function="get-stdin"] [Instruction::CallInterface] (async? sync, @ enter)');
    const _interface_call_currentTaskID = startCurrentTask(0, false, 'get-stdin');
    const ret = getStdin();
    _debugLog('[iface="wasi:cli/stdin@0.2.6", function="get-stdin"] [Instruction::CallInterface] (sync, @ post-call)');
    endCurrentTask(0);
    if (!(ret instanceof InputStream)) {
      throw new TypeError('Resource error: Not a valid "InputStream" resource.');
    }
    var handle0 = ret[symbolRscHandle];
    if (!handle0) {
      const rep = ret[symbolRscRep] || ++captureCnt2;
      captureTable2.set(rep, ret);
      handle0 = rscTableCreateOwn(handleTable2, rep);
    }
    _debugLog('[iface="wasi:cli/stdin@0.2.6", function="get-stdin"][Instruction::Return]', {
      funcName: 'get-stdin',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    return handle0;
  }
  
  
  function trampoline11() {
    _debugLog('[iface="wasi:cli/stdout@0.2.6", function="get-stdout"] [Instruction::CallInterface] (async? sync, @ enter)');
    const _interface_call_currentTaskID = startCurrentTask(0, false, 'get-stdout');
    const ret = getStdout();
    _debugLog('[iface="wasi:cli/stdout@0.2.6", function="get-stdout"] [Instruction::CallInterface] (sync, @ post-call)');
    endCurrentTask(0);
    if (!(ret instanceof OutputStream)) {
      throw new TypeError('Resource error: Not a valid "OutputStream" resource.');
    }
    var handle0 = ret[symbolRscHandle];
    if (!handle0) {
      const rep = ret[symbolRscRep] || ++captureCnt3;
      captureTable3.set(rep, ret);
      handle0 = rscTableCreateOwn(handleTable3, rep);
    }
    _debugLog('[iface="wasi:cli/stdout@0.2.6", function="get-stdout"][Instruction::Return]', {
      funcName: 'get-stdout',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    return handle0;
  }
  
  
  function trampoline12() {
    _debugLog('[iface="wasi:cli/stderr@0.2.6", function="get-stderr"] [Instruction::CallInterface] (async? sync, @ enter)');
    const _interface_call_currentTaskID = startCurrentTask(0, false, 'get-stderr');
    const ret = getStderr();
    _debugLog('[iface="wasi:cli/stderr@0.2.6", function="get-stderr"] [Instruction::CallInterface] (sync, @ post-call)');
    endCurrentTask(0);
    if (!(ret instanceof OutputStream)) {
      throw new TypeError('Resource error: Not a valid "OutputStream" resource.');
    }
    var handle0 = ret[symbolRscHandle];
    if (!handle0) {
      const rep = ret[symbolRscRep] || ++captureCnt3;
      captureTable3.set(rep, ret);
      handle0 = rscTableCreateOwn(handleTable3, rep);
    }
    _debugLog('[iface="wasi:cli/stderr@0.2.6", function="get-stderr"][Instruction::Return]', {
      funcName: 'get-stderr',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    return handle0;
  }
  
  let exports1;
  let memory0;
  let realloc0;
  
  function trampoline13(arg0, arg1, arg2) {
    var ptr0 = arg0;
    var len0 = arg1;
    var result0 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr0, len0));
    _debugLog('[iface="vercel:python-analysis/host-utils", function="read-file"] [Instruction::CallInterface] (async? sync, @ enter)');
    const _interface_call_currentTaskID = startCurrentTask(0, false, 'read-file');
    let ret;
    try {
      ret = { tag: 'ok', val: readFile(result0)};
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    _debugLog('[iface="vercel:python-analysis/host-utils", function="read-file"] [Instruction::CallInterface] (sync, @ post-call)');
    endCurrentTask(0);
    var variant3 = ret;
    switch (variant3.tag) {
      case 'ok': {
        const e = variant3.val;
        dataView(memory0).setInt8(arg2 + 0, 0, true);
        var ptr1 = utf8Encode(e, realloc0, memory0);
        var len1 = utf8EncodedLen;
        dataView(memory0).setUint32(arg2 + 8, len1, true);
        dataView(memory0).setUint32(arg2 + 4, ptr1, true);
        break;
      }
      case 'err': {
        const e = variant3.val;
        dataView(memory0).setInt8(arg2 + 0, 1, true);
        var ptr2 = utf8Encode(e, realloc0, memory0);
        var len2 = utf8EncodedLen;
        dataView(memory0).setUint32(arg2 + 8, len2, true);
        dataView(memory0).setUint32(arg2 + 4, ptr2, true);
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="vercel:python-analysis/host-utils", function="read-file"][Instruction::Return]', {
      funcName: 'read-file',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  
  function trampoline14(arg0, arg1, arg2) {
    var ptr0 = arg0;
    var len0 = arg1;
    var result0 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr0, len0));
    _debugLog('[iface="vercel:python-analysis/host-utils", function="nfkc-normalize"] [Instruction::CallInterface] (async? sync, @ enter)');
    const _interface_call_currentTaskID = startCurrentTask(0, false, 'nfkc-normalize');
    const ret = nfkcNormalize(result0);
    _debugLog('[iface="vercel:python-analysis/host-utils", function="nfkc-normalize"] [Instruction::CallInterface] (sync, @ post-call)');
    endCurrentTask(0);
    var ptr1 = utf8Encode(ret, realloc0, memory0);
    var len1 = utf8EncodedLen;
    dataView(memory0).setUint32(arg2 + 4, len1, true);
    dataView(memory0).setUint32(arg2 + 0, ptr1, true);
    _debugLog('[iface="vercel:python-analysis/host-utils", function="nfkc-normalize"][Instruction::Return]', {
      funcName: 'nfkc-normalize',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  
  function trampoline15(arg0, arg1, arg2) {
    var ptr0 = arg0;
    var len0 = arg1;
    var result0 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr0, len0));
    _debugLog('[iface="vercel:python-analysis/host-utils", function="domain-to-ascii"] [Instruction::CallInterface] (async? sync, @ enter)');
    const _interface_call_currentTaskID = startCurrentTask(0, false, 'domain-to-ascii');
    let ret;
    try {
      ret = { tag: 'ok', val: domainToAscii(result0)};
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    _debugLog('[iface="vercel:python-analysis/host-utils", function="domain-to-ascii"] [Instruction::CallInterface] (sync, @ post-call)');
    endCurrentTask(0);
    var variant3 = ret;
    switch (variant3.tag) {
      case 'ok': {
        const e = variant3.val;
        dataView(memory0).setInt8(arg2 + 0, 0, true);
        var ptr1 = utf8Encode(e, realloc0, memory0);
        var len1 = utf8EncodedLen;
        dataView(memory0).setUint32(arg2 + 8, len1, true);
        dataView(memory0).setUint32(arg2 + 4, ptr1, true);
        break;
      }
      case 'err': {
        const e = variant3.val;
        dataView(memory0).setInt8(arg2 + 0, 1, true);
        var ptr2 = utf8Encode(e, realloc0, memory0);
        var len2 = utf8EncodedLen;
        dataView(memory0).setUint32(arg2 + 8, len2, true);
        dataView(memory0).setUint32(arg2 + 4, ptr2, true);
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="vercel:python-analysis/host-utils", function="domain-to-ascii"][Instruction::Return]', {
      funcName: 'domain-to-ascii',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  
  function trampoline16(arg0) {
    _debugLog('[iface="wasi:random/insecure-seed@0.2.6", function="insecure-seed"] [Instruction::CallInterface] (async? sync, @ enter)');
    const _interface_call_currentTaskID = startCurrentTask(0, false, 'insecure-seed');
    const ret = insecureSeed();
    _debugLog('[iface="wasi:random/insecure-seed@0.2.6", function="insecure-seed"] [Instruction::CallInterface] (sync, @ post-call)');
    endCurrentTask(0);
    var [tuple0_0, tuple0_1] = ret;
    dataView(memory0).setBigInt64(arg0 + 0, toUint64(tuple0_0), true);
    dataView(memory0).setBigInt64(arg0 + 8, toUint64(tuple0_1), true);
    _debugLog('[iface="wasi:random/insecure-seed@0.2.6", function="insecure-seed"][Instruction::Return]', {
      funcName: 'insecure-seed',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  const handleTable1 = [T_FLAG, 0];
  const captureTable1= new Map();
  let captureCnt1 = 0;
  handleTables[1] = handleTable1;
  
  function trampoline17(arg0, arg1) {
    var handle1 = arg0;
    var rep2 = handleTable3[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable3.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(OutputStream.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:io/streams@0.2.6", function="[method]output-stream.check-write"] [Instruction::CallInterface] (async? sync, @ enter)');
    const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]output-stream.check-write');
    let ret;
    try {
      ret = { tag: 'ok', val: rsc0.checkWrite()};
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    _debugLog('[iface="wasi:io/streams@0.2.6", function="[method]output-stream.check-write"] [Instruction::CallInterface] (sync, @ post-call)');
    for (const rsc of curResourceBorrows) {
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    endCurrentTask(0);
    var variant5 = ret;
    switch (variant5.tag) {
      case 'ok': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg1 + 0, 0, true);
        dataView(memory0).setBigInt64(arg1 + 8, toUint64(e), true);
        break;
      }
      case 'err': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg1 + 0, 1, true);
        var variant4 = e;
        switch (variant4.tag) {
          case 'last-operation-failed': {
            const e = variant4.val;
            dataView(memory0).setInt8(arg1 + 8, 0, true);
            if (!(e instanceof Error$1)) {
              throw new TypeError('Resource error: Not a valid "Error" resource.');
            }
            var handle3 = e[symbolRscHandle];
            if (!handle3) {
              const rep = e[symbolRscRep] || ++captureCnt1;
              captureTable1.set(rep, e);
              handle3 = rscTableCreateOwn(handleTable1, rep);
            }
            dataView(memory0).setInt32(arg1 + 12, handle3, true);
            break;
          }
          case 'closed': {
            dataView(memory0).setInt8(arg1 + 8, 1, true);
            break;
          }
          default: {
            throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant4.tag)}\` (received \`${variant4}\`) specified for \`StreamError\``);
          }
        }
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:io/streams@0.2.6", function="[method]output-stream.check-write"][Instruction::Return]', {
      funcName: '[method]output-stream.check-write',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  
  function trampoline18(arg0, arg1, arg2, arg3) {
    var handle1 = arg0;
    var rep2 = handleTable3[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable3.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(OutputStream.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    curResourceBorrows.push(rsc0);
    var ptr3 = arg1;
    var len3 = arg2;
    var result3 = new Uint8Array(memory0.buffer.slice(ptr3, ptr3 + len3 * 1));
    _debugLog('[iface="wasi:io/streams@0.2.6", function="[method]output-stream.write"] [Instruction::CallInterface] (async? sync, @ enter)');
    const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]output-stream.write');
    let ret;
    try {
      ret = { tag: 'ok', val: rsc0.write(result3)};
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    _debugLog('[iface="wasi:io/streams@0.2.6", function="[method]output-stream.write"] [Instruction::CallInterface] (sync, @ post-call)');
    for (const rsc of curResourceBorrows) {
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    endCurrentTask(0);
    var variant6 = ret;
    switch (variant6.tag) {
      case 'ok': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg3 + 0, 0, true);
        break;
      }
      case 'err': {
        const e = variant6.val;
        dataView(memory0).setInt8(arg3 + 0, 1, true);
        var variant5 = e;
        switch (variant5.tag) {
          case 'last-operation-failed': {
            const e = variant5.val;
            dataView(memory0).setInt8(arg3 + 4, 0, true);
            if (!(e instanceof Error$1)) {
              throw new TypeError('Resource error: Not a valid "Error" resource.');
            }
            var handle4 = e[symbolRscHandle];
            if (!handle4) {
              const rep = e[symbolRscRep] || ++captureCnt1;
              captureTable1.set(rep, e);
              handle4 = rscTableCreateOwn(handleTable1, rep);
            }
            dataView(memory0).setInt32(arg3 + 8, handle4, true);
            break;
          }
          case 'closed': {
            dataView(memory0).setInt8(arg3 + 4, 1, true);
            break;
          }
          default: {
            throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant5.tag)}\` (received \`${variant5}\`) specified for \`StreamError\``);
          }
        }
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:io/streams@0.2.6", function="[method]output-stream.write"][Instruction::Return]', {
      funcName: '[method]output-stream.write',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  
  function trampoline19(arg0, arg1) {
    var handle1 = arg0;
    var rep2 = handleTable3[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable3.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(OutputStream.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:io/streams@0.2.6", function="[method]output-stream.blocking-flush"] [Instruction::CallInterface] (async? sync, @ enter)');
    const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]output-stream.blocking-flush');
    let ret;
    try {
      ret = { tag: 'ok', val: rsc0.blockingFlush()};
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    _debugLog('[iface="wasi:io/streams@0.2.6", function="[method]output-stream.blocking-flush"] [Instruction::CallInterface] (sync, @ post-call)');
    for (const rsc of curResourceBorrows) {
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    endCurrentTask(0);
    var variant5 = ret;
    switch (variant5.tag) {
      case 'ok': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg1 + 0, 0, true);
        break;
      }
      case 'err': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg1 + 0, 1, true);
        var variant4 = e;
        switch (variant4.tag) {
          case 'last-operation-failed': {
            const e = variant4.val;
            dataView(memory0).setInt8(arg1 + 4, 0, true);
            if (!(e instanceof Error$1)) {
              throw new TypeError('Resource error: Not a valid "Error" resource.');
            }
            var handle3 = e[symbolRscHandle];
            if (!handle3) {
              const rep = e[symbolRscRep] || ++captureCnt1;
              captureTable1.set(rep, e);
              handle3 = rscTableCreateOwn(handleTable1, rep);
            }
            dataView(memory0).setInt32(arg1 + 8, handle3, true);
            break;
          }
          case 'closed': {
            dataView(memory0).setInt8(arg1 + 4, 1, true);
            break;
          }
          default: {
            throw new TypeError(`invalid variant tag value \`${JSON.stringify(variant4.tag)}\` (received \`${variant4}\`) specified for \`StreamError\``);
          }
        }
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:io/streams@0.2.6", function="[method]output-stream.blocking-flush"][Instruction::Return]', {
      funcName: '[method]output-stream.blocking-flush',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  const handleTable6 = [T_FLAG, 0];
  const captureTable6= new Map();
  let captureCnt6 = 0;
  handleTables[6] = handleTable6;
  
  function trampoline20(arg0, arg1, arg2) {
    var handle1 = arg0;
    var rep2 = handleTable6[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable6.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Descriptor.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:filesystem/types@0.2.6", function="[method]descriptor.read-via-stream"] [Instruction::CallInterface] (async? sync, @ enter)');
    const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]descriptor.read-via-stream');
    let ret;
    try {
      ret = { tag: 'ok', val: rsc0.readViaStream(BigInt.asUintN(64, arg1))};
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.6", function="[method]descriptor.read-via-stream"] [Instruction::CallInterface] (sync, @ post-call)');
    for (const rsc of curResourceBorrows) {
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    endCurrentTask(0);
    var variant5 = ret;
    switch (variant5.tag) {
      case 'ok': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg2 + 0, 0, true);
        if (!(e instanceof InputStream)) {
          throw new TypeError('Resource error: Not a valid "InputStream" resource.');
        }
        var handle3 = e[symbolRscHandle];
        if (!handle3) {
          const rep = e[symbolRscRep] || ++captureCnt2;
          captureTable2.set(rep, e);
          handle3 = rscTableCreateOwn(handleTable2, rep);
        }
        dataView(memory0).setInt32(arg2 + 4, handle3, true);
        break;
      }
      case 'err': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg2 + 0, 1, true);
        var val4 = e;
        let enum4;
        switch (val4) {
          case 'access': {
            enum4 = 0;
            break;
          }
          case 'would-block': {
            enum4 = 1;
            break;
          }
          case 'already': {
            enum4 = 2;
            break;
          }
          case 'bad-descriptor': {
            enum4 = 3;
            break;
          }
          case 'busy': {
            enum4 = 4;
            break;
          }
          case 'deadlock': {
            enum4 = 5;
            break;
          }
          case 'quota': {
            enum4 = 6;
            break;
          }
          case 'exist': {
            enum4 = 7;
            break;
          }
          case 'file-too-large': {
            enum4 = 8;
            break;
          }
          case 'illegal-byte-sequence': {
            enum4 = 9;
            break;
          }
          case 'in-progress': {
            enum4 = 10;
            break;
          }
          case 'interrupted': {
            enum4 = 11;
            break;
          }
          case 'invalid': {
            enum4 = 12;
            break;
          }
          case 'io': {
            enum4 = 13;
            break;
          }
          case 'is-directory': {
            enum4 = 14;
            break;
          }
          case 'loop': {
            enum4 = 15;
            break;
          }
          case 'too-many-links': {
            enum4 = 16;
            break;
          }
          case 'message-size': {
            enum4 = 17;
            break;
          }
          case 'name-too-long': {
            enum4 = 18;
            break;
          }
          case 'no-device': {
            enum4 = 19;
            break;
          }
          case 'no-entry': {
            enum4 = 20;
            break;
          }
          case 'no-lock': {
            enum4 = 21;
            break;
          }
          case 'insufficient-memory': {
            enum4 = 22;
            break;
          }
          case 'insufficient-space': {
            enum4 = 23;
            break;
          }
          case 'not-directory': {
            enum4 = 24;
            break;
          }
          case 'not-empty': {
            enum4 = 25;
            break;
          }
          case 'not-recoverable': {
            enum4 = 26;
            break;
          }
          case 'unsupported': {
            enum4 = 27;
            break;
          }
          case 'no-tty': {
            enum4 = 28;
            break;
          }
          case 'no-such-device': {
            enum4 = 29;
            break;
          }
          case 'overflow': {
            enum4 = 30;
            break;
          }
          case 'not-permitted': {
            enum4 = 31;
            break;
          }
          case 'pipe': {
            enum4 = 32;
            break;
          }
          case 'read-only': {
            enum4 = 33;
            break;
          }
          case 'invalid-seek': {
            enum4 = 34;
            break;
          }
          case 'text-file-busy': {
            enum4 = 35;
            break;
          }
          case 'cross-device': {
            enum4 = 36;
            break;
          }
          default: {
            if ((e) instanceof Error) {
              console.error(e);
            }
            
            throw new TypeError(`"${val4}" is not one of the cases of error-code`);
          }
        }
        dataView(memory0).setInt8(arg2 + 4, enum4, true);
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.6", function="[method]descriptor.read-via-stream"][Instruction::Return]', {
      funcName: '[method]descriptor.read-via-stream',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  
  function trampoline21(arg0, arg1, arg2) {
    var handle1 = arg0;
    var rep2 = handleTable6[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable6.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Descriptor.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:filesystem/types@0.2.6", function="[method]descriptor.write-via-stream"] [Instruction::CallInterface] (async? sync, @ enter)');
    const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]descriptor.write-via-stream');
    let ret;
    try {
      ret = { tag: 'ok', val: rsc0.writeViaStream(BigInt.asUintN(64, arg1))};
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.6", function="[method]descriptor.write-via-stream"] [Instruction::CallInterface] (sync, @ post-call)');
    for (const rsc of curResourceBorrows) {
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    endCurrentTask(0);
    var variant5 = ret;
    switch (variant5.tag) {
      case 'ok': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg2 + 0, 0, true);
        if (!(e instanceof OutputStream)) {
          throw new TypeError('Resource error: Not a valid "OutputStream" resource.');
        }
        var handle3 = e[symbolRscHandle];
        if (!handle3) {
          const rep = e[symbolRscRep] || ++captureCnt3;
          captureTable3.set(rep, e);
          handle3 = rscTableCreateOwn(handleTable3, rep);
        }
        dataView(memory0).setInt32(arg2 + 4, handle3, true);
        break;
      }
      case 'err': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg2 + 0, 1, true);
        var val4 = e;
        let enum4;
        switch (val4) {
          case 'access': {
            enum4 = 0;
            break;
          }
          case 'would-block': {
            enum4 = 1;
            break;
          }
          case 'already': {
            enum4 = 2;
            break;
          }
          case 'bad-descriptor': {
            enum4 = 3;
            break;
          }
          case 'busy': {
            enum4 = 4;
            break;
          }
          case 'deadlock': {
            enum4 = 5;
            break;
          }
          case 'quota': {
            enum4 = 6;
            break;
          }
          case 'exist': {
            enum4 = 7;
            break;
          }
          case 'file-too-large': {
            enum4 = 8;
            break;
          }
          case 'illegal-byte-sequence': {
            enum4 = 9;
            break;
          }
          case 'in-progress': {
            enum4 = 10;
            break;
          }
          case 'interrupted': {
            enum4 = 11;
            break;
          }
          case 'invalid': {
            enum4 = 12;
            break;
          }
          case 'io': {
            enum4 = 13;
            break;
          }
          case 'is-directory': {
            enum4 = 14;
            break;
          }
          case 'loop': {
            enum4 = 15;
            break;
          }
          case 'too-many-links': {
            enum4 = 16;
            break;
          }
          case 'message-size': {
            enum4 = 17;
            break;
          }
          case 'name-too-long': {
            enum4 = 18;
            break;
          }
          case 'no-device': {
            enum4 = 19;
            break;
          }
          case 'no-entry': {
            enum4 = 20;
            break;
          }
          case 'no-lock': {
            enum4 = 21;
            break;
          }
          case 'insufficient-memory': {
            enum4 = 22;
            break;
          }
          case 'insufficient-space': {
            enum4 = 23;
            break;
          }
          case 'not-directory': {
            enum4 = 24;
            break;
          }
          case 'not-empty': {
            enum4 = 25;
            break;
          }
          case 'not-recoverable': {
            enum4 = 26;
            break;
          }
          case 'unsupported': {
            enum4 = 27;
            break;
          }
          case 'no-tty': {
            enum4 = 28;
            break;
          }
          case 'no-such-device': {
            enum4 = 29;
            break;
          }
          case 'overflow': {
            enum4 = 30;
            break;
          }
          case 'not-permitted': {
            enum4 = 31;
            break;
          }
          case 'pipe': {
            enum4 = 32;
            break;
          }
          case 'read-only': {
            enum4 = 33;
            break;
          }
          case 'invalid-seek': {
            enum4 = 34;
            break;
          }
          case 'text-file-busy': {
            enum4 = 35;
            break;
          }
          case 'cross-device': {
            enum4 = 36;
            break;
          }
          default: {
            if ((e) instanceof Error) {
              console.error(e);
            }
            
            throw new TypeError(`"${val4}" is not one of the cases of error-code`);
          }
        }
        dataView(memory0).setInt8(arg2 + 4, enum4, true);
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.6", function="[method]descriptor.write-via-stream"][Instruction::Return]', {
      funcName: '[method]descriptor.write-via-stream',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  
  function trampoline22(arg0, arg1) {
    var handle1 = arg0;
    var rep2 = handleTable6[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable6.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Descriptor.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:filesystem/types@0.2.6", function="[method]descriptor.append-via-stream"] [Instruction::CallInterface] (async? sync, @ enter)');
    const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]descriptor.append-via-stream');
    let ret;
    try {
      ret = { tag: 'ok', val: rsc0.appendViaStream()};
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.6", function="[method]descriptor.append-via-stream"] [Instruction::CallInterface] (sync, @ post-call)');
    for (const rsc of curResourceBorrows) {
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    endCurrentTask(0);
    var variant5 = ret;
    switch (variant5.tag) {
      case 'ok': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg1 + 0, 0, true);
        if (!(e instanceof OutputStream)) {
          throw new TypeError('Resource error: Not a valid "OutputStream" resource.');
        }
        var handle3 = e[symbolRscHandle];
        if (!handle3) {
          const rep = e[symbolRscRep] || ++captureCnt3;
          captureTable3.set(rep, e);
          handle3 = rscTableCreateOwn(handleTable3, rep);
        }
        dataView(memory0).setInt32(arg1 + 4, handle3, true);
        break;
      }
      case 'err': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg1 + 0, 1, true);
        var val4 = e;
        let enum4;
        switch (val4) {
          case 'access': {
            enum4 = 0;
            break;
          }
          case 'would-block': {
            enum4 = 1;
            break;
          }
          case 'already': {
            enum4 = 2;
            break;
          }
          case 'bad-descriptor': {
            enum4 = 3;
            break;
          }
          case 'busy': {
            enum4 = 4;
            break;
          }
          case 'deadlock': {
            enum4 = 5;
            break;
          }
          case 'quota': {
            enum4 = 6;
            break;
          }
          case 'exist': {
            enum4 = 7;
            break;
          }
          case 'file-too-large': {
            enum4 = 8;
            break;
          }
          case 'illegal-byte-sequence': {
            enum4 = 9;
            break;
          }
          case 'in-progress': {
            enum4 = 10;
            break;
          }
          case 'interrupted': {
            enum4 = 11;
            break;
          }
          case 'invalid': {
            enum4 = 12;
            break;
          }
          case 'io': {
            enum4 = 13;
            break;
          }
          case 'is-directory': {
            enum4 = 14;
            break;
          }
          case 'loop': {
            enum4 = 15;
            break;
          }
          case 'too-many-links': {
            enum4 = 16;
            break;
          }
          case 'message-size': {
            enum4 = 17;
            break;
          }
          case 'name-too-long': {
            enum4 = 18;
            break;
          }
          case 'no-device': {
            enum4 = 19;
            break;
          }
          case 'no-entry': {
            enum4 = 20;
            break;
          }
          case 'no-lock': {
            enum4 = 21;
            break;
          }
          case 'insufficient-memory': {
            enum4 = 22;
            break;
          }
          case 'insufficient-space': {
            enum4 = 23;
            break;
          }
          case 'not-directory': {
            enum4 = 24;
            break;
          }
          case 'not-empty': {
            enum4 = 25;
            break;
          }
          case 'not-recoverable': {
            enum4 = 26;
            break;
          }
          case 'unsupported': {
            enum4 = 27;
            break;
          }
          case 'no-tty': {
            enum4 = 28;
            break;
          }
          case 'no-such-device': {
            enum4 = 29;
            break;
          }
          case 'overflow': {
            enum4 = 30;
            break;
          }
          case 'not-permitted': {
            enum4 = 31;
            break;
          }
          case 'pipe': {
            enum4 = 32;
            break;
          }
          case 'read-only': {
            enum4 = 33;
            break;
          }
          case 'invalid-seek': {
            enum4 = 34;
            break;
          }
          case 'text-file-busy': {
            enum4 = 35;
            break;
          }
          case 'cross-device': {
            enum4 = 36;
            break;
          }
          default: {
            if ((e) instanceof Error) {
              console.error(e);
            }
            
            throw new TypeError(`"${val4}" is not one of the cases of error-code`);
          }
        }
        dataView(memory0).setInt8(arg1 + 4, enum4, true);
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.6", function="[method]descriptor.append-via-stream"][Instruction::Return]', {
      funcName: '[method]descriptor.append-via-stream',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  
  function trampoline23(arg0, arg1) {
    var handle1 = arg0;
    var rep2 = handleTable6[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable6.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Descriptor.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:filesystem/types@0.2.6", function="[method]descriptor.get-flags"] [Instruction::CallInterface] (async? sync, @ enter)');
    const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]descriptor.get-flags');
    let ret;
    try {
      ret = { tag: 'ok', val: rsc0.getFlags()};
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.6", function="[method]descriptor.get-flags"] [Instruction::CallInterface] (sync, @ post-call)');
    for (const rsc of curResourceBorrows) {
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    endCurrentTask(0);
    var variant5 = ret;
    switch (variant5.tag) {
      case 'ok': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg1 + 0, 0, true);
        let flags3 = 0;
        if (typeof e === 'object' && e !== null) {
          flags3 = Boolean(e.read) << 0 | Boolean(e.write) << 1 | Boolean(e.fileIntegritySync) << 2 | Boolean(e.dataIntegritySync) << 3 | Boolean(e.requestedWriteSync) << 4 | Boolean(e.mutateDirectory) << 5;
        } else if (e !== null && e!== undefined) {
          throw new TypeError('only an object, undefined or null can be converted to flags');
        }
        dataView(memory0).setInt8(arg1 + 1, flags3, true);
        break;
      }
      case 'err': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg1 + 0, 1, true);
        var val4 = e;
        let enum4;
        switch (val4) {
          case 'access': {
            enum4 = 0;
            break;
          }
          case 'would-block': {
            enum4 = 1;
            break;
          }
          case 'already': {
            enum4 = 2;
            break;
          }
          case 'bad-descriptor': {
            enum4 = 3;
            break;
          }
          case 'busy': {
            enum4 = 4;
            break;
          }
          case 'deadlock': {
            enum4 = 5;
            break;
          }
          case 'quota': {
            enum4 = 6;
            break;
          }
          case 'exist': {
            enum4 = 7;
            break;
          }
          case 'file-too-large': {
            enum4 = 8;
            break;
          }
          case 'illegal-byte-sequence': {
            enum4 = 9;
            break;
          }
          case 'in-progress': {
            enum4 = 10;
            break;
          }
          case 'interrupted': {
            enum4 = 11;
            break;
          }
          case 'invalid': {
            enum4 = 12;
            break;
          }
          case 'io': {
            enum4 = 13;
            break;
          }
          case 'is-directory': {
            enum4 = 14;
            break;
          }
          case 'loop': {
            enum4 = 15;
            break;
          }
          case 'too-many-links': {
            enum4 = 16;
            break;
          }
          case 'message-size': {
            enum4 = 17;
            break;
          }
          case 'name-too-long': {
            enum4 = 18;
            break;
          }
          case 'no-device': {
            enum4 = 19;
            break;
          }
          case 'no-entry': {
            enum4 = 20;
            break;
          }
          case 'no-lock': {
            enum4 = 21;
            break;
          }
          case 'insufficient-memory': {
            enum4 = 22;
            break;
          }
          case 'insufficient-space': {
            enum4 = 23;
            break;
          }
          case 'not-directory': {
            enum4 = 24;
            break;
          }
          case 'not-empty': {
            enum4 = 25;
            break;
          }
          case 'not-recoverable': {
            enum4 = 26;
            break;
          }
          case 'unsupported': {
            enum4 = 27;
            break;
          }
          case 'no-tty': {
            enum4 = 28;
            break;
          }
          case 'no-such-device': {
            enum4 = 29;
            break;
          }
          case 'overflow': {
            enum4 = 30;
            break;
          }
          case 'not-permitted': {
            enum4 = 31;
            break;
          }
          case 'pipe': {
            enum4 = 32;
            break;
          }
          case 'read-only': {
            enum4 = 33;
            break;
          }
          case 'invalid-seek': {
            enum4 = 34;
            break;
          }
          case 'text-file-busy': {
            enum4 = 35;
            break;
          }
          case 'cross-device': {
            enum4 = 36;
            break;
          }
          default: {
            if ((e) instanceof Error) {
              console.error(e);
            }
            
            throw new TypeError(`"${val4}" is not one of the cases of error-code`);
          }
        }
        dataView(memory0).setInt8(arg1 + 1, enum4, true);
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.6", function="[method]descriptor.get-flags"][Instruction::Return]', {
      funcName: '[method]descriptor.get-flags',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  
  function trampoline24(arg0, arg1) {
    var handle1 = arg0;
    var rep2 = handleTable6[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable6.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Descriptor.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:filesystem/types@0.2.6", function="[method]descriptor.stat"] [Instruction::CallInterface] (async? sync, @ enter)');
    const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]descriptor.stat');
    let ret;
    try {
      ret = { tag: 'ok', val: rsc0.stat()};
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.6", function="[method]descriptor.stat"] [Instruction::CallInterface] (sync, @ post-call)');
    for (const rsc of curResourceBorrows) {
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    endCurrentTask(0);
    var variant12 = ret;
    switch (variant12.tag) {
      case 'ok': {
        const e = variant12.val;
        dataView(memory0).setInt8(arg1 + 0, 0, true);
        var {type: v3_0, linkCount: v3_1, size: v3_2, dataAccessTimestamp: v3_3, dataModificationTimestamp: v3_4, statusChangeTimestamp: v3_5 } = e;
        var val4 = v3_0;
        let enum4;
        switch (val4) {
          case 'unknown': {
            enum4 = 0;
            break;
          }
          case 'block-device': {
            enum4 = 1;
            break;
          }
          case 'character-device': {
            enum4 = 2;
            break;
          }
          case 'directory': {
            enum4 = 3;
            break;
          }
          case 'fifo': {
            enum4 = 4;
            break;
          }
          case 'symbolic-link': {
            enum4 = 5;
            break;
          }
          case 'regular-file': {
            enum4 = 6;
            break;
          }
          case 'socket': {
            enum4 = 7;
            break;
          }
          default: {
            if ((v3_0) instanceof Error) {
              console.error(v3_0);
            }
            
            throw new TypeError(`"${val4}" is not one of the cases of descriptor-type`);
          }
        }
        dataView(memory0).setInt8(arg1 + 8, enum4, true);
        dataView(memory0).setBigInt64(arg1 + 16, toUint64(v3_1), true);
        dataView(memory0).setBigInt64(arg1 + 24, toUint64(v3_2), true);
        var variant6 = v3_3;
        if (variant6 === null || variant6=== undefined) {
          dataView(memory0).setInt8(arg1 + 32, 0, true);
        } else {
          const e = variant6;
          dataView(memory0).setInt8(arg1 + 32, 1, true);
          var {seconds: v5_0, nanoseconds: v5_1 } = e;
          dataView(memory0).setBigInt64(arg1 + 40, toUint64(v5_0), true);
          dataView(memory0).setInt32(arg1 + 48, toUint32(v5_1), true);
        }
        var variant8 = v3_4;
        if (variant8 === null || variant8=== undefined) {
          dataView(memory0).setInt8(arg1 + 56, 0, true);
        } else {
          const e = variant8;
          dataView(memory0).setInt8(arg1 + 56, 1, true);
          var {seconds: v7_0, nanoseconds: v7_1 } = e;
          dataView(memory0).setBigInt64(arg1 + 64, toUint64(v7_0), true);
          dataView(memory0).setInt32(arg1 + 72, toUint32(v7_1), true);
        }
        var variant10 = v3_5;
        if (variant10 === null || variant10=== undefined) {
          dataView(memory0).setInt8(arg1 + 80, 0, true);
        } else {
          const e = variant10;
          dataView(memory0).setInt8(arg1 + 80, 1, true);
          var {seconds: v9_0, nanoseconds: v9_1 } = e;
          dataView(memory0).setBigInt64(arg1 + 88, toUint64(v9_0), true);
          dataView(memory0).setInt32(arg1 + 96, toUint32(v9_1), true);
        }
        break;
      }
      case 'err': {
        const e = variant12.val;
        dataView(memory0).setInt8(arg1 + 0, 1, true);
        var val11 = e;
        let enum11;
        switch (val11) {
          case 'access': {
            enum11 = 0;
            break;
          }
          case 'would-block': {
            enum11 = 1;
            break;
          }
          case 'already': {
            enum11 = 2;
            break;
          }
          case 'bad-descriptor': {
            enum11 = 3;
            break;
          }
          case 'busy': {
            enum11 = 4;
            break;
          }
          case 'deadlock': {
            enum11 = 5;
            break;
          }
          case 'quota': {
            enum11 = 6;
            break;
          }
          case 'exist': {
            enum11 = 7;
            break;
          }
          case 'file-too-large': {
            enum11 = 8;
            break;
          }
          case 'illegal-byte-sequence': {
            enum11 = 9;
            break;
          }
          case 'in-progress': {
            enum11 = 10;
            break;
          }
          case 'interrupted': {
            enum11 = 11;
            break;
          }
          case 'invalid': {
            enum11 = 12;
            break;
          }
          case 'io': {
            enum11 = 13;
            break;
          }
          case 'is-directory': {
            enum11 = 14;
            break;
          }
          case 'loop': {
            enum11 = 15;
            break;
          }
          case 'too-many-links': {
            enum11 = 16;
            break;
          }
          case 'message-size': {
            enum11 = 17;
            break;
          }
          case 'name-too-long': {
            enum11 = 18;
            break;
          }
          case 'no-device': {
            enum11 = 19;
            break;
          }
          case 'no-entry': {
            enum11 = 20;
            break;
          }
          case 'no-lock': {
            enum11 = 21;
            break;
          }
          case 'insufficient-memory': {
            enum11 = 22;
            break;
          }
          case 'insufficient-space': {
            enum11 = 23;
            break;
          }
          case 'not-directory': {
            enum11 = 24;
            break;
          }
          case 'not-empty': {
            enum11 = 25;
            break;
          }
          case 'not-recoverable': {
            enum11 = 26;
            break;
          }
          case 'unsupported': {
            enum11 = 27;
            break;
          }
          case 'no-tty': {
            enum11 = 28;
            break;
          }
          case 'no-such-device': {
            enum11 = 29;
            break;
          }
          case 'overflow': {
            enum11 = 30;
            break;
          }
          case 'not-permitted': {
            enum11 = 31;
            break;
          }
          case 'pipe': {
            enum11 = 32;
            break;
          }
          case 'read-only': {
            enum11 = 33;
            break;
          }
          case 'invalid-seek': {
            enum11 = 34;
            break;
          }
          case 'text-file-busy': {
            enum11 = 35;
            break;
          }
          case 'cross-device': {
            enum11 = 36;
            break;
          }
          default: {
            if ((e) instanceof Error) {
              console.error(e);
            }
            
            throw new TypeError(`"${val11}" is not one of the cases of error-code`);
          }
        }
        dataView(memory0).setInt8(arg1 + 8, enum11, true);
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.6", function="[method]descriptor.stat"][Instruction::Return]', {
      funcName: '[method]descriptor.stat',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  
  function trampoline25(arg0, arg1, arg2, arg3, arg4) {
    var handle1 = arg0;
    var rep2 = handleTable6[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable6.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Descriptor.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    curResourceBorrows.push(rsc0);
    if ((arg1 & 4294967294) !== 0) {
      throw new TypeError('flags have extraneous bits set');
    }
    var flags3 = {
      symlinkFollow: Boolean(arg1 & 1),
    };
    var ptr4 = arg2;
    var len4 = arg3;
    var result4 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr4, len4));
    _debugLog('[iface="wasi:filesystem/types@0.2.6", function="[method]descriptor.stat-at"] [Instruction::CallInterface] (async? sync, @ enter)');
    const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]descriptor.stat-at');
    let ret;
    try {
      ret = { tag: 'ok', val: rsc0.statAt(flags3, result4)};
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.6", function="[method]descriptor.stat-at"] [Instruction::CallInterface] (sync, @ post-call)');
    for (const rsc of curResourceBorrows) {
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    endCurrentTask(0);
    var variant14 = ret;
    switch (variant14.tag) {
      case 'ok': {
        const e = variant14.val;
        dataView(memory0).setInt8(arg4 + 0, 0, true);
        var {type: v5_0, linkCount: v5_1, size: v5_2, dataAccessTimestamp: v5_3, dataModificationTimestamp: v5_4, statusChangeTimestamp: v5_5 } = e;
        var val6 = v5_0;
        let enum6;
        switch (val6) {
          case 'unknown': {
            enum6 = 0;
            break;
          }
          case 'block-device': {
            enum6 = 1;
            break;
          }
          case 'character-device': {
            enum6 = 2;
            break;
          }
          case 'directory': {
            enum6 = 3;
            break;
          }
          case 'fifo': {
            enum6 = 4;
            break;
          }
          case 'symbolic-link': {
            enum6 = 5;
            break;
          }
          case 'regular-file': {
            enum6 = 6;
            break;
          }
          case 'socket': {
            enum6 = 7;
            break;
          }
          default: {
            if ((v5_0) instanceof Error) {
              console.error(v5_0);
            }
            
            throw new TypeError(`"${val6}" is not one of the cases of descriptor-type`);
          }
        }
        dataView(memory0).setInt8(arg4 + 8, enum6, true);
        dataView(memory0).setBigInt64(arg4 + 16, toUint64(v5_1), true);
        dataView(memory0).setBigInt64(arg4 + 24, toUint64(v5_2), true);
        var variant8 = v5_3;
        if (variant8 === null || variant8=== undefined) {
          dataView(memory0).setInt8(arg4 + 32, 0, true);
        } else {
          const e = variant8;
          dataView(memory0).setInt8(arg4 + 32, 1, true);
          var {seconds: v7_0, nanoseconds: v7_1 } = e;
          dataView(memory0).setBigInt64(arg4 + 40, toUint64(v7_0), true);
          dataView(memory0).setInt32(arg4 + 48, toUint32(v7_1), true);
        }
        var variant10 = v5_4;
        if (variant10 === null || variant10=== undefined) {
          dataView(memory0).setInt8(arg4 + 56, 0, true);
        } else {
          const e = variant10;
          dataView(memory0).setInt8(arg4 + 56, 1, true);
          var {seconds: v9_0, nanoseconds: v9_1 } = e;
          dataView(memory0).setBigInt64(arg4 + 64, toUint64(v9_0), true);
          dataView(memory0).setInt32(arg4 + 72, toUint32(v9_1), true);
        }
        var variant12 = v5_5;
        if (variant12 === null || variant12=== undefined) {
          dataView(memory0).setInt8(arg4 + 80, 0, true);
        } else {
          const e = variant12;
          dataView(memory0).setInt8(arg4 + 80, 1, true);
          var {seconds: v11_0, nanoseconds: v11_1 } = e;
          dataView(memory0).setBigInt64(arg4 + 88, toUint64(v11_0), true);
          dataView(memory0).setInt32(arg4 + 96, toUint32(v11_1), true);
        }
        break;
      }
      case 'err': {
        const e = variant14.val;
        dataView(memory0).setInt8(arg4 + 0, 1, true);
        var val13 = e;
        let enum13;
        switch (val13) {
          case 'access': {
            enum13 = 0;
            break;
          }
          case 'would-block': {
            enum13 = 1;
            break;
          }
          case 'already': {
            enum13 = 2;
            break;
          }
          case 'bad-descriptor': {
            enum13 = 3;
            break;
          }
          case 'busy': {
            enum13 = 4;
            break;
          }
          case 'deadlock': {
            enum13 = 5;
            break;
          }
          case 'quota': {
            enum13 = 6;
            break;
          }
          case 'exist': {
            enum13 = 7;
            break;
          }
          case 'file-too-large': {
            enum13 = 8;
            break;
          }
          case 'illegal-byte-sequence': {
            enum13 = 9;
            break;
          }
          case 'in-progress': {
            enum13 = 10;
            break;
          }
          case 'interrupted': {
            enum13 = 11;
            break;
          }
          case 'invalid': {
            enum13 = 12;
            break;
          }
          case 'io': {
            enum13 = 13;
            break;
          }
          case 'is-directory': {
            enum13 = 14;
            break;
          }
          case 'loop': {
            enum13 = 15;
            break;
          }
          case 'too-many-links': {
            enum13 = 16;
            break;
          }
          case 'message-size': {
            enum13 = 17;
            break;
          }
          case 'name-too-long': {
            enum13 = 18;
            break;
          }
          case 'no-device': {
            enum13 = 19;
            break;
          }
          case 'no-entry': {
            enum13 = 20;
            break;
          }
          case 'no-lock': {
            enum13 = 21;
            break;
          }
          case 'insufficient-memory': {
            enum13 = 22;
            break;
          }
          case 'insufficient-space': {
            enum13 = 23;
            break;
          }
          case 'not-directory': {
            enum13 = 24;
            break;
          }
          case 'not-empty': {
            enum13 = 25;
            break;
          }
          case 'not-recoverable': {
            enum13 = 26;
            break;
          }
          case 'unsupported': {
            enum13 = 27;
            break;
          }
          case 'no-tty': {
            enum13 = 28;
            break;
          }
          case 'no-such-device': {
            enum13 = 29;
            break;
          }
          case 'overflow': {
            enum13 = 30;
            break;
          }
          case 'not-permitted': {
            enum13 = 31;
            break;
          }
          case 'pipe': {
            enum13 = 32;
            break;
          }
          case 'read-only': {
            enum13 = 33;
            break;
          }
          case 'invalid-seek': {
            enum13 = 34;
            break;
          }
          case 'text-file-busy': {
            enum13 = 35;
            break;
          }
          case 'cross-device': {
            enum13 = 36;
            break;
          }
          default: {
            if ((e) instanceof Error) {
              console.error(e);
            }
            
            throw new TypeError(`"${val13}" is not one of the cases of error-code`);
          }
        }
        dataView(memory0).setInt8(arg4 + 8, enum13, true);
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.6", function="[method]descriptor.stat-at"][Instruction::Return]', {
      funcName: '[method]descriptor.stat-at',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  
  function trampoline26(arg0, arg1) {
    var handle1 = arg0;
    var rep2 = handleTable6[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable6.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Descriptor.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    curResourceBorrows.push(rsc0);
    _debugLog('[iface="wasi:filesystem/types@0.2.6", function="[method]descriptor.metadata-hash"] [Instruction::CallInterface] (async? sync, @ enter)');
    const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]descriptor.metadata-hash');
    let ret;
    try {
      ret = { tag: 'ok', val: rsc0.metadataHash()};
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.6", function="[method]descriptor.metadata-hash"] [Instruction::CallInterface] (sync, @ post-call)');
    for (const rsc of curResourceBorrows) {
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    endCurrentTask(0);
    var variant5 = ret;
    switch (variant5.tag) {
      case 'ok': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg1 + 0, 0, true);
        var {lower: v3_0, upper: v3_1 } = e;
        dataView(memory0).setBigInt64(arg1 + 8, toUint64(v3_0), true);
        dataView(memory0).setBigInt64(arg1 + 16, toUint64(v3_1), true);
        break;
      }
      case 'err': {
        const e = variant5.val;
        dataView(memory0).setInt8(arg1 + 0, 1, true);
        var val4 = e;
        let enum4;
        switch (val4) {
          case 'access': {
            enum4 = 0;
            break;
          }
          case 'would-block': {
            enum4 = 1;
            break;
          }
          case 'already': {
            enum4 = 2;
            break;
          }
          case 'bad-descriptor': {
            enum4 = 3;
            break;
          }
          case 'busy': {
            enum4 = 4;
            break;
          }
          case 'deadlock': {
            enum4 = 5;
            break;
          }
          case 'quota': {
            enum4 = 6;
            break;
          }
          case 'exist': {
            enum4 = 7;
            break;
          }
          case 'file-too-large': {
            enum4 = 8;
            break;
          }
          case 'illegal-byte-sequence': {
            enum4 = 9;
            break;
          }
          case 'in-progress': {
            enum4 = 10;
            break;
          }
          case 'interrupted': {
            enum4 = 11;
            break;
          }
          case 'invalid': {
            enum4 = 12;
            break;
          }
          case 'io': {
            enum4 = 13;
            break;
          }
          case 'is-directory': {
            enum4 = 14;
            break;
          }
          case 'loop': {
            enum4 = 15;
            break;
          }
          case 'too-many-links': {
            enum4 = 16;
            break;
          }
          case 'message-size': {
            enum4 = 17;
            break;
          }
          case 'name-too-long': {
            enum4 = 18;
            break;
          }
          case 'no-device': {
            enum4 = 19;
            break;
          }
          case 'no-entry': {
            enum4 = 20;
            break;
          }
          case 'no-lock': {
            enum4 = 21;
            break;
          }
          case 'insufficient-memory': {
            enum4 = 22;
            break;
          }
          case 'insufficient-space': {
            enum4 = 23;
            break;
          }
          case 'not-directory': {
            enum4 = 24;
            break;
          }
          case 'not-empty': {
            enum4 = 25;
            break;
          }
          case 'not-recoverable': {
            enum4 = 26;
            break;
          }
          case 'unsupported': {
            enum4 = 27;
            break;
          }
          case 'no-tty': {
            enum4 = 28;
            break;
          }
          case 'no-such-device': {
            enum4 = 29;
            break;
          }
          case 'overflow': {
            enum4 = 30;
            break;
          }
          case 'not-permitted': {
            enum4 = 31;
            break;
          }
          case 'pipe': {
            enum4 = 32;
            break;
          }
          case 'read-only': {
            enum4 = 33;
            break;
          }
          case 'invalid-seek': {
            enum4 = 34;
            break;
          }
          case 'text-file-busy': {
            enum4 = 35;
            break;
          }
          case 'cross-device': {
            enum4 = 36;
            break;
          }
          default: {
            if ((e) instanceof Error) {
              console.error(e);
            }
            
            throw new TypeError(`"${val4}" is not one of the cases of error-code`);
          }
        }
        dataView(memory0).setInt8(arg1 + 8, enum4, true);
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.6", function="[method]descriptor.metadata-hash"][Instruction::Return]', {
      funcName: '[method]descriptor.metadata-hash',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  
  function trampoline27(arg0, arg1, arg2, arg3, arg4) {
    var handle1 = arg0;
    var rep2 = handleTable6[(handle1 << 1) + 1] & ~T_FLAG;
    var rsc0 = captureTable6.get(rep2);
    if (!rsc0) {
      rsc0 = Object.create(Descriptor.prototype);
      Object.defineProperty(rsc0, symbolRscHandle, { writable: true, value: handle1});
      Object.defineProperty(rsc0, symbolRscRep, { writable: true, value: rep2});
    }
    curResourceBorrows.push(rsc0);
    if ((arg1 & 4294967294) !== 0) {
      throw new TypeError('flags have extraneous bits set');
    }
    var flags3 = {
      symlinkFollow: Boolean(arg1 & 1),
    };
    var ptr4 = arg2;
    var len4 = arg3;
    var result4 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr4, len4));
    _debugLog('[iface="wasi:filesystem/types@0.2.6", function="[method]descriptor.metadata-hash-at"] [Instruction::CallInterface] (async? sync, @ enter)');
    const _interface_call_currentTaskID = startCurrentTask(0, false, '[method]descriptor.metadata-hash-at');
    let ret;
    try {
      ret = { tag: 'ok', val: rsc0.metadataHashAt(flags3, result4)};
    } catch (e) {
      ret = { tag: 'err', val: getErrorPayload(e) };
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.6", function="[method]descriptor.metadata-hash-at"] [Instruction::CallInterface] (sync, @ post-call)');
    for (const rsc of curResourceBorrows) {
      rsc[symbolRscHandle] = undefined;
    }
    curResourceBorrows = [];
    endCurrentTask(0);
    var variant7 = ret;
    switch (variant7.tag) {
      case 'ok': {
        const e = variant7.val;
        dataView(memory0).setInt8(arg4 + 0, 0, true);
        var {lower: v5_0, upper: v5_1 } = e;
        dataView(memory0).setBigInt64(arg4 + 8, toUint64(v5_0), true);
        dataView(memory0).setBigInt64(arg4 + 16, toUint64(v5_1), true);
        break;
      }
      case 'err': {
        const e = variant7.val;
        dataView(memory0).setInt8(arg4 + 0, 1, true);
        var val6 = e;
        let enum6;
        switch (val6) {
          case 'access': {
            enum6 = 0;
            break;
          }
          case 'would-block': {
            enum6 = 1;
            break;
          }
          case 'already': {
            enum6 = 2;
            break;
          }
          case 'bad-descriptor': {
            enum6 = 3;
            break;
          }
          case 'busy': {
            enum6 = 4;
            break;
          }
          case 'deadlock': {
            enum6 = 5;
            break;
          }
          case 'quota': {
            enum6 = 6;
            break;
          }
          case 'exist': {
            enum6 = 7;
            break;
          }
          case 'file-too-large': {
            enum6 = 8;
            break;
          }
          case 'illegal-byte-sequence': {
            enum6 = 9;
            break;
          }
          case 'in-progress': {
            enum6 = 10;
            break;
          }
          case 'interrupted': {
            enum6 = 11;
            break;
          }
          case 'invalid': {
            enum6 = 12;
            break;
          }
          case 'io': {
            enum6 = 13;
            break;
          }
          case 'is-directory': {
            enum6 = 14;
            break;
          }
          case 'loop': {
            enum6 = 15;
            break;
          }
          case 'too-many-links': {
            enum6 = 16;
            break;
          }
          case 'message-size': {
            enum6 = 17;
            break;
          }
          case 'name-too-long': {
            enum6 = 18;
            break;
          }
          case 'no-device': {
            enum6 = 19;
            break;
          }
          case 'no-entry': {
            enum6 = 20;
            break;
          }
          case 'no-lock': {
            enum6 = 21;
            break;
          }
          case 'insufficient-memory': {
            enum6 = 22;
            break;
          }
          case 'insufficient-space': {
            enum6 = 23;
            break;
          }
          case 'not-directory': {
            enum6 = 24;
            break;
          }
          case 'not-empty': {
            enum6 = 25;
            break;
          }
          case 'not-recoverable': {
            enum6 = 26;
            break;
          }
          case 'unsupported': {
            enum6 = 27;
            break;
          }
          case 'no-tty': {
            enum6 = 28;
            break;
          }
          case 'no-such-device': {
            enum6 = 29;
            break;
          }
          case 'overflow': {
            enum6 = 30;
            break;
          }
          case 'not-permitted': {
            enum6 = 31;
            break;
          }
          case 'pipe': {
            enum6 = 32;
            break;
          }
          case 'read-only': {
            enum6 = 33;
            break;
          }
          case 'invalid-seek': {
            enum6 = 34;
            break;
          }
          case 'text-file-busy': {
            enum6 = 35;
            break;
          }
          case 'cross-device': {
            enum6 = 36;
            break;
          }
          default: {
            if ((e) instanceof Error) {
              console.error(e);
            }
            
            throw new TypeError(`"${val6}" is not one of the cases of error-code`);
          }
        }
        dataView(memory0).setInt8(arg4 + 8, enum6, true);
        break;
      }
      default: {
        throw new TypeError('invalid variant specified for result');
      }
    }
    _debugLog('[iface="wasi:filesystem/types@0.2.6", function="[method]descriptor.metadata-hash-at"][Instruction::Return]', {
      funcName: '[method]descriptor.metadata-hash-at',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  
  function trampoline28(arg0) {
    _debugLog('[iface="wasi:cli/environment@0.2.6", function="get-environment"] [Instruction::CallInterface] (async? sync, @ enter)');
    const _interface_call_currentTaskID = startCurrentTask(0, false, 'get-environment');
    const ret = getEnvironment();
    _debugLog('[iface="wasi:cli/environment@0.2.6", function="get-environment"] [Instruction::CallInterface] (sync, @ post-call)');
    endCurrentTask(0);
    var vec3 = ret;
    var len3 = vec3.length;
    var result3 = realloc0(0, 0, 4, len3 * 16);
    for (let i = 0; i < vec3.length; i++) {
      const e = vec3[i];
      const base = result3 + i * 16;var [tuple0_0, tuple0_1] = e;
      var ptr1 = utf8Encode(tuple0_0, realloc0, memory0);
      var len1 = utf8EncodedLen;
      dataView(memory0).setUint32(base + 4, len1, true);
      dataView(memory0).setUint32(base + 0, ptr1, true);
      var ptr2 = utf8Encode(tuple0_1, realloc0, memory0);
      var len2 = utf8EncodedLen;
      dataView(memory0).setUint32(base + 12, len2, true);
      dataView(memory0).setUint32(base + 8, ptr2, true);
    }
    dataView(memory0).setUint32(arg0 + 4, len3, true);
    dataView(memory0).setUint32(arg0 + 0, result3, true);
    _debugLog('[iface="wasi:cli/environment@0.2.6", function="get-environment"][Instruction::Return]', {
      funcName: 'get-environment',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  const handleTable4 = [T_FLAG, 0];
  const captureTable4= new Map();
  let captureCnt4 = 0;
  handleTables[4] = handleTable4;
  
  function trampoline29(arg0) {
    _debugLog('[iface="wasi:cli/terminal-stdin@0.2.6", function="get-terminal-stdin"] [Instruction::CallInterface] (async? sync, @ enter)');
    const _interface_call_currentTaskID = startCurrentTask(0, false, 'get-terminal-stdin');
    const ret = getTerminalStdin();
    _debugLog('[iface="wasi:cli/terminal-stdin@0.2.6", function="get-terminal-stdin"] [Instruction::CallInterface] (sync, @ post-call)');
    endCurrentTask(0);
    var variant1 = ret;
    if (variant1 === null || variant1=== undefined) {
      dataView(memory0).setInt8(arg0 + 0, 0, true);
    } else {
      const e = variant1;
      dataView(memory0).setInt8(arg0 + 0, 1, true);
      if (!(e instanceof TerminalInput)) {
        throw new TypeError('Resource error: Not a valid "TerminalInput" resource.');
      }
      var handle0 = e[symbolRscHandle];
      if (!handle0) {
        const rep = e[symbolRscRep] || ++captureCnt4;
        captureTable4.set(rep, e);
        handle0 = rscTableCreateOwn(handleTable4, rep);
      }
      dataView(memory0).setInt32(arg0 + 4, handle0, true);
    }
    _debugLog('[iface="wasi:cli/terminal-stdin@0.2.6", function="get-terminal-stdin"][Instruction::Return]', {
      funcName: 'get-terminal-stdin',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  const handleTable5 = [T_FLAG, 0];
  const captureTable5= new Map();
  let captureCnt5 = 0;
  handleTables[5] = handleTable5;
  
  function trampoline30(arg0) {
    _debugLog('[iface="wasi:cli/terminal-stdout@0.2.6", function="get-terminal-stdout"] [Instruction::CallInterface] (async? sync, @ enter)');
    const _interface_call_currentTaskID = startCurrentTask(0, false, 'get-terminal-stdout');
    const ret = getTerminalStdout();
    _debugLog('[iface="wasi:cli/terminal-stdout@0.2.6", function="get-terminal-stdout"] [Instruction::CallInterface] (sync, @ post-call)');
    endCurrentTask(0);
    var variant1 = ret;
    if (variant1 === null || variant1=== undefined) {
      dataView(memory0).setInt8(arg0 + 0, 0, true);
    } else {
      const e = variant1;
      dataView(memory0).setInt8(arg0 + 0, 1, true);
      if (!(e instanceof TerminalOutput)) {
        throw new TypeError('Resource error: Not a valid "TerminalOutput" resource.');
      }
      var handle0 = e[symbolRscHandle];
      if (!handle0) {
        const rep = e[symbolRscRep] || ++captureCnt5;
        captureTable5.set(rep, e);
        handle0 = rscTableCreateOwn(handleTable5, rep);
      }
      dataView(memory0).setInt32(arg0 + 4, handle0, true);
    }
    _debugLog('[iface="wasi:cli/terminal-stdout@0.2.6", function="get-terminal-stdout"][Instruction::Return]', {
      funcName: 'get-terminal-stdout',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  
  function trampoline31(arg0) {
    _debugLog('[iface="wasi:cli/terminal-stderr@0.2.6", function="get-terminal-stderr"] [Instruction::CallInterface] (async? sync, @ enter)');
    const _interface_call_currentTaskID = startCurrentTask(0, false, 'get-terminal-stderr');
    const ret = getTerminalStderr();
    _debugLog('[iface="wasi:cli/terminal-stderr@0.2.6", function="get-terminal-stderr"] [Instruction::CallInterface] (sync, @ post-call)');
    endCurrentTask(0);
    var variant1 = ret;
    if (variant1 === null || variant1=== undefined) {
      dataView(memory0).setInt8(arg0 + 0, 0, true);
    } else {
      const e = variant1;
      dataView(memory0).setInt8(arg0 + 0, 1, true);
      if (!(e instanceof TerminalOutput)) {
        throw new TypeError('Resource error: Not a valid "TerminalOutput" resource.');
      }
      var handle0 = e[symbolRscHandle];
      if (!handle0) {
        const rep = e[symbolRscRep] || ++captureCnt5;
        captureTable5.set(rep, e);
        handle0 = rscTableCreateOwn(handleTable5, rep);
      }
      dataView(memory0).setInt32(arg0 + 4, handle0, true);
    }
    _debugLog('[iface="wasi:cli/terminal-stderr@0.2.6", function="get-terminal-stderr"][Instruction::Return]', {
      funcName: 'get-terminal-stderr',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  
  function trampoline32(arg0) {
    _debugLog('[iface="wasi:filesystem/preopens@0.2.6", function="get-directories"] [Instruction::CallInterface] (async? sync, @ enter)');
    const _interface_call_currentTaskID = startCurrentTask(0, false, 'get-directories');
    const ret = getDirectories();
    _debugLog('[iface="wasi:filesystem/preopens@0.2.6", function="get-directories"] [Instruction::CallInterface] (sync, @ post-call)');
    endCurrentTask(0);
    var vec3 = ret;
    var len3 = vec3.length;
    var result3 = realloc0(0, 0, 4, len3 * 12);
    for (let i = 0; i < vec3.length; i++) {
      const e = vec3[i];
      const base = result3 + i * 12;var [tuple0_0, tuple0_1] = e;
      if (!(tuple0_0 instanceof Descriptor)) {
        throw new TypeError('Resource error: Not a valid "Descriptor" resource.');
      }
      var handle1 = tuple0_0[symbolRscHandle];
      if (!handle1) {
        const rep = tuple0_0[symbolRscRep] || ++captureCnt6;
        captureTable6.set(rep, tuple0_0);
        handle1 = rscTableCreateOwn(handleTable6, rep);
      }
      dataView(memory0).setInt32(base + 0, handle1, true);
      var ptr2 = utf8Encode(tuple0_1, realloc0, memory0);
      var len2 = utf8EncodedLen;
      dataView(memory0).setUint32(base + 8, len2, true);
      dataView(memory0).setUint32(base + 4, ptr2, true);
    }
    dataView(memory0).setUint32(arg0 + 4, len3, true);
    dataView(memory0).setUint32(arg0 + 0, result3, true);
    _debugLog('[iface="wasi:filesystem/preopens@0.2.6", function="get-directories"][Instruction::Return]', {
      funcName: 'get-directories',
      paramCount: 0,
      async: false,
      postReturn: false
    });
  }
  
  let exports2;
  let postReturn0;
  let postReturn1;
  let postReturn2;
  let postReturn3;
  let postReturn4;
  let postReturn5;
  let postReturn6;
  function trampoline0(handle) {
    const handleEntry = rscTableRemove(handleTable1, handle);
    if (handleEntry.own) {
      
      const rsc = captureTable1.get(handleEntry.rep);
      if (rsc) {
        if (rsc[symbolDispose]) rsc[symbolDispose]();
        captureTable1.delete(handleEntry.rep);
      } else if (Error$1[symbolCabiDispose]) {
        Error$1[symbolCabiDispose](handleEntry.rep);
      }
    }
  }
  function trampoline1(handle) {
    const handleEntry = rscTableRemove(handleTable0, handle);
    if (handleEntry.own) {
      
      const rsc = captureTable0.get(handleEntry.rep);
      if (rsc) {
        if (rsc[symbolDispose]) rsc[symbolDispose]();
        captureTable0.delete(handleEntry.rep);
      } else if (Pollable[symbolCabiDispose]) {
        Pollable[symbolCabiDispose](handleEntry.rep);
      }
    }
  }
  function trampoline2(handle) {
    const handleEntry = rscTableRemove(handleTable2, handle);
    if (handleEntry.own) {
      
      const rsc = captureTable2.get(handleEntry.rep);
      if (rsc) {
        if (rsc[symbolDispose]) rsc[symbolDispose]();
        captureTable2.delete(handleEntry.rep);
      } else if (InputStream[symbolCabiDispose]) {
        InputStream[symbolCabiDispose](handleEntry.rep);
      }
    }
  }
  function trampoline3(handle) {
    const handleEntry = rscTableRemove(handleTable3, handle);
    if (handleEntry.own) {
      
      const rsc = captureTable3.get(handleEntry.rep);
      if (rsc) {
        if (rsc[symbolDispose]) rsc[symbolDispose]();
        captureTable3.delete(handleEntry.rep);
      } else if (OutputStream[symbolCabiDispose]) {
        OutputStream[symbolCabiDispose](handleEntry.rep);
      }
    }
  }
  function trampoline4(handle) {
    const handleEntry = rscTableRemove(handleTable4, handle);
    if (handleEntry.own) {
      
      const rsc = captureTable4.get(handleEntry.rep);
      if (rsc) {
        if (rsc[symbolDispose]) rsc[symbolDispose]();
        captureTable4.delete(handleEntry.rep);
      } else if (TerminalInput[symbolCabiDispose]) {
        TerminalInput[symbolCabiDispose](handleEntry.rep);
      }
    }
  }
  function trampoline5(handle) {
    const handleEntry = rscTableRemove(handleTable5, handle);
    if (handleEntry.own) {
      
      const rsc = captureTable5.get(handleEntry.rep);
      if (rsc) {
        if (rsc[symbolDispose]) rsc[symbolDispose]();
        captureTable5.delete(handleEntry.rep);
      } else if (TerminalOutput[symbolCabiDispose]) {
        TerminalOutput[symbolCabiDispose](handleEntry.rep);
      }
    }
  }
  function trampoline6(handle) {
    const handleEntry = rscTableRemove(handleTable6, handle);
    if (handleEntry.own) {
      
      const rsc = captureTable6.get(handleEntry.rep);
      if (rsc) {
        if (rsc[symbolDispose]) rsc[symbolDispose]();
        captureTable6.delete(handleEntry.rep);
      } else if (Descriptor[symbolCabiDispose]) {
        Descriptor[symbolCabiDispose](handleEntry.rep);
      }
    }
  }
  Promise.all([module0, module1, module2]).catch(() => {});
  ({ exports: exports0 } = yield instantiateCore(yield module1));
  ({ exports: exports1 } = yield instantiateCore(yield module0, {
    'vercel:python-analysis/host-utils': {
      'domain-to-ascii': exports0['2'],
      'nfkc-normalize': exports0['1'],
      'read-file': exports0['0'],
    },
    'wasi:cli/environment@0.2.0': {
      'get-environment': exports0['15'],
    },
    'wasi:cli/exit@0.2.0': {
      exit: trampoline7,
    },
    'wasi:cli/stderr@0.2.0': {
      'get-stderr': trampoline12,
    },
    'wasi:cli/stdin@0.2.0': {
      'get-stdin': trampoline10,
    },
    'wasi:cli/stdout@0.2.0': {
      'get-stdout': trampoline11,
    },
    'wasi:cli/terminal-input@0.2.0': {
      '[resource-drop]terminal-input': trampoline4,
    },
    'wasi:cli/terminal-output@0.2.0': {
      '[resource-drop]terminal-output': trampoline5,
    },
    'wasi:cli/terminal-stderr@0.2.0': {
      'get-terminal-stderr': exports0['18'],
    },
    'wasi:cli/terminal-stdin@0.2.0': {
      'get-terminal-stdin': exports0['16'],
    },
    'wasi:cli/terminal-stdout@0.2.0': {
      'get-terminal-stdout': exports0['17'],
    },
    'wasi:filesystem/preopens@0.2.0': {
      'get-directories': exports0['19'],
    },
    'wasi:filesystem/types@0.2.0': {
      '[method]descriptor.append-via-stream': exports0['9'],
      '[method]descriptor.get-flags': exports0['10'],
      '[method]descriptor.metadata-hash': exports0['13'],
      '[method]descriptor.metadata-hash-at': exports0['14'],
      '[method]descriptor.read-via-stream': exports0['7'],
      '[method]descriptor.stat': exports0['11'],
      '[method]descriptor.stat-at': exports0['12'],
      '[method]descriptor.write-via-stream': exports0['8'],
      '[resource-drop]descriptor': trampoline6,
    },
    'wasi:io/error@0.2.0': {
      '[resource-drop]error': trampoline0,
    },
    'wasi:io/poll@0.2.0': {
      '[method]pollable.block': trampoline8,
      '[resource-drop]pollable': trampoline1,
    },
    'wasi:io/streams@0.2.0': {
      '[method]output-stream.blocking-flush': exports0['6'],
      '[method]output-stream.check-write': exports0['4'],
      '[method]output-stream.subscribe': trampoline9,
      '[method]output-stream.write': exports0['5'],
      '[resource-drop]input-stream': trampoline2,
      '[resource-drop]output-stream': trampoline3,
    },
    'wasi:random/insecure-seed@0.2.4': {
      'insecure-seed': exports0['3'],
    },
  }));
  memory0 = exports1.memory;
  realloc0 = exports1.cabi_realloc;
  ({ exports: exports2 } = yield instantiateCore(yield module2, {
    '': {
      $imports: exports0.$imports,
      '0': trampoline13,
      '1': trampoline14,
      '10': trampoline23,
      '11': trampoline24,
      '12': trampoline25,
      '13': trampoline26,
      '14': trampoline27,
      '15': trampoline28,
      '16': trampoline29,
      '17': trampoline30,
      '18': trampoline31,
      '19': trampoline32,
      '2': trampoline15,
      '3': trampoline16,
      '4': trampoline17,
      '5': trampoline18,
      '6': trampoline19,
      '7': trampoline20,
      '8': trampoline21,
      '9': trampoline22,
    },
  }));
  postReturn0 = exports1['cabi_post_evaluate-marker'];
  postReturn1 = exports1['cabi_post_parse-dist-metadata'];
  postReturn2 = exports1['cabi_post_parse-record'];
  postReturn3 = exports1['cabi_post_parse-direct-url'];
  postReturn4 = exports1['cabi_post_normalize-package-name'];
  postReturn5 = exports1['cabi_post_parse-requirements-txt'];
  postReturn6 = exports1['cabi_post_parse-pep508'];
  let exports1FindAppOrHandler;
  
  function findAppOrHandler(arg0) {
    var ptr0 = utf8Encode(arg0, realloc0, memory0);
    var len0 = utf8EncodedLen;
    _debugLog('[iface="find-app-or-handler", function="find-app-or-handler"][Instruction::CallWasm] enter', {
      funcName: 'find-app-or-handler',
      paramCount: 2,
      async: false,
      postReturn: true,
    });
    const _wasm_call_currentTaskID = startCurrentTask(0, false, 'exports1FindAppOrHandler');
    const ret = exports1FindAppOrHandler(ptr0, len0);
    endCurrentTask(0);
    let variant2;
    switch (dataView(memory0).getUint8(ret + 0, true)) {
      case 0: {
        variant2 = undefined;
        break;
      }
      case 1: {
        var ptr1 = dataView(memory0).getUint32(ret + 4, true);
        var len1 = dataView(memory0).getUint32(ret + 8, true);
        var result1 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr1, len1));
        variant2 = result1;
        break;
      }
      default: {
        throw new TypeError('invalid variant discriminant for option');
      }
    }
    _debugLog('[iface="find-app-or-handler", function="find-app-or-handler"][Instruction::Return]', {
      funcName: 'find-app-or-handler',
      paramCount: 1,
      async: false,
      postReturn: true
    });
    const retCopy = variant2;
    
    let cstate = getOrCreateAsyncState(0);
    cstate.mayLeave = false;
    postReturn0(ret);
    cstate.mayLeave = true;
    return retCopy;
    
  }
  let exports1GetStringConstant;
  
  function getStringConstant(arg0, arg1) {
    var ptr0 = utf8Encode(arg0, realloc0, memory0);
    var len0 = utf8EncodedLen;
    var ptr1 = utf8Encode(arg1, realloc0, memory0);
    var len1 = utf8EncodedLen;
    _debugLog('[iface="get-string-constant", function="get-string-constant"][Instruction::CallWasm] enter', {
      funcName: 'get-string-constant',
      paramCount: 4,
      async: false,
      postReturn: true,
    });
    const _wasm_call_currentTaskID = startCurrentTask(0, false, 'exports1GetStringConstant');
    const ret = exports1GetStringConstant(ptr0, len0, ptr1, len1);
    endCurrentTask(0);
    let variant3;
    switch (dataView(memory0).getUint8(ret + 0, true)) {
      case 0: {
        variant3 = undefined;
        break;
      }
      case 1: {
        var ptr2 = dataView(memory0).getUint32(ret + 4, true);
        var len2 = dataView(memory0).getUint32(ret + 8, true);
        var result2 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr2, len2));
        variant3 = result2;
        break;
      }
      default: {
        throw new TypeError('invalid variant discriminant for option');
      }
    }
    _debugLog('[iface="get-string-constant", function="get-string-constant"][Instruction::Return]', {
      funcName: 'get-string-constant',
      paramCount: 1,
      async: false,
      postReturn: true
    });
    const retCopy = variant3;
    
    let cstate = getOrCreateAsyncState(0);
    cstate.mayLeave = false;
    postReturn0(ret);
    cstate.mayLeave = true;
    return retCopy;
    
  }
  let exports1ContainsTopLevelCallable;
  
  function containsTopLevelCallable(arg0, arg1) {
    var ptr0 = utf8Encode(arg0, realloc0, memory0);
    var len0 = utf8EncodedLen;
    var ptr1 = utf8Encode(arg1, realloc0, memory0);
    var len1 = utf8EncodedLen;
    _debugLog('[iface="contains-top-level-callable", function="contains-top-level-callable"][Instruction::CallWasm] enter', {
      funcName: 'contains-top-level-callable',
      paramCount: 4,
      async: false,
      postReturn: false,
    });
    const _wasm_call_currentTaskID = startCurrentTask(0, false, 'exports1ContainsTopLevelCallable');
    const ret = exports1ContainsTopLevelCallable(ptr0, len0, ptr1, len1);
    endCurrentTask(0);
    var bool2 = ret;
    _debugLog('[iface="contains-top-level-callable", function="contains-top-level-callable"][Instruction::Return]', {
      funcName: 'contains-top-level-callable',
      paramCount: 1,
      async: false,
      postReturn: false
    });
    return bool2 == 0 ? false : (bool2 == 1 ? true : throwInvalidBool());
  }
  let exports1ParseDistMetadata;
  
  function parseDistMetadata(arg0) {
    var val0 = arg0;
    var len0 = val0.byteLength;
    var ptr0 = realloc0(0, 0, 1, len0 * 1);
    var src0 = new Uint8Array(val0.buffer || val0, val0.byteOffset, len0 * 1);
    (new Uint8Array(memory0.buffer, ptr0, len0 * 1)).set(src0);
    _debugLog('[iface="parse-dist-metadata", function="parse-dist-metadata"][Instruction::CallWasm] enter', {
      funcName: 'parse-dist-metadata',
      paramCount: 2,
      async: false,
      postReturn: true,
    });
    const _wasm_call_currentTaskID = startCurrentTask(0, false, 'exports1ParseDistMetadata');
    const ret = exports1ParseDistMetadata(ptr0, len0);
    endCurrentTask(0);
    let variant40;
    switch (dataView(memory0).getUint8(ret + 0, true)) {
      case 0: {
        var ptr1 = dataView(memory0).getUint32(ret + 4, true);
        var len1 = dataView(memory0).getUint32(ret + 8, true);
        var result1 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr1, len1));
        var ptr2 = dataView(memory0).getUint32(ret + 12, true);
        var len2 = dataView(memory0).getUint32(ret + 16, true);
        var result2 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr2, len2));
        var ptr3 = dataView(memory0).getUint32(ret + 20, true);
        var len3 = dataView(memory0).getUint32(ret + 24, true);
        var result3 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr3, len3));
        let variant5;
        switch (dataView(memory0).getUint8(ret + 28, true)) {
          case 0: {
            variant5 = undefined;
            break;
          }
          case 1: {
            var ptr4 = dataView(memory0).getUint32(ret + 32, true);
            var len4 = dataView(memory0).getUint32(ret + 36, true);
            var result4 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr4, len4));
            variant5 = result4;
            break;
          }
          default: {
            throw new TypeError('invalid variant discriminant for option');
          }
        }
        let variant7;
        switch (dataView(memory0).getUint8(ret + 40, true)) {
          case 0: {
            variant7 = undefined;
            break;
          }
          case 1: {
            var ptr6 = dataView(memory0).getUint32(ret + 44, true);
            var len6 = dataView(memory0).getUint32(ret + 48, true);
            var result6 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr6, len6));
            variant7 = result6;
            break;
          }
          default: {
            throw new TypeError('invalid variant discriminant for option');
          }
        }
        let variant9;
        switch (dataView(memory0).getUint8(ret + 52, true)) {
          case 0: {
            variant9 = undefined;
            break;
          }
          case 1: {
            var ptr8 = dataView(memory0).getUint32(ret + 56, true);
            var len8 = dataView(memory0).getUint32(ret + 60, true);
            var result8 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr8, len8));
            variant9 = result8;
            break;
          }
          default: {
            throw new TypeError('invalid variant discriminant for option');
          }
        }
        var len11 = dataView(memory0).getUint32(ret + 68, true);
        var base11 = dataView(memory0).getUint32(ret + 64, true);
        var result11 = [];
        for (let i = 0; i < len11; i++) {
          const base = base11 + i * 8;
          var ptr10 = dataView(memory0).getUint32(base + 0, true);
          var len10 = dataView(memory0).getUint32(base + 4, true);
          var result10 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr10, len10));
          result11.push(result10);
        }
        let variant13;
        switch (dataView(memory0).getUint8(ret + 72, true)) {
          case 0: {
            variant13 = undefined;
            break;
          }
          case 1: {
            var ptr12 = dataView(memory0).getUint32(ret + 76, true);
            var len12 = dataView(memory0).getUint32(ret + 80, true);
            var result12 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr12, len12));
            variant13 = result12;
            break;
          }
          default: {
            throw new TypeError('invalid variant discriminant for option');
          }
        }
        var len15 = dataView(memory0).getUint32(ret + 88, true);
        var base15 = dataView(memory0).getUint32(ret + 84, true);
        var result15 = [];
        for (let i = 0; i < len15; i++) {
          const base = base15 + i * 8;
          var ptr14 = dataView(memory0).getUint32(base + 0, true);
          var len14 = dataView(memory0).getUint32(base + 4, true);
          var result14 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr14, len14));
          result15.push(result14);
        }
        let variant17;
        switch (dataView(memory0).getUint8(ret + 92, true)) {
          case 0: {
            variant17 = undefined;
            break;
          }
          case 1: {
            var ptr16 = dataView(memory0).getUint32(ret + 96, true);
            var len16 = dataView(memory0).getUint32(ret + 100, true);
            var result16 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr16, len16));
            variant17 = result16;
            break;
          }
          default: {
            throw new TypeError('invalid variant discriminant for option');
          }
        }
        let variant19;
        switch (dataView(memory0).getUint8(ret + 104, true)) {
          case 0: {
            variant19 = undefined;
            break;
          }
          case 1: {
            var ptr18 = dataView(memory0).getUint32(ret + 108, true);
            var len18 = dataView(memory0).getUint32(ret + 112, true);
            var result18 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr18, len18));
            variant19 = result18;
            break;
          }
          default: {
            throw new TypeError('invalid variant discriminant for option');
          }
        }
        let variant21;
        switch (dataView(memory0).getUint8(ret + 116, true)) {
          case 0: {
            variant21 = undefined;
            break;
          }
          case 1: {
            var ptr20 = dataView(memory0).getUint32(ret + 120, true);
            var len20 = dataView(memory0).getUint32(ret + 124, true);
            var result20 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr20, len20));
            variant21 = result20;
            break;
          }
          default: {
            throw new TypeError('invalid variant discriminant for option');
          }
        }
        let variant23;
        switch (dataView(memory0).getUint8(ret + 128, true)) {
          case 0: {
            variant23 = undefined;
            break;
          }
          case 1: {
            var ptr22 = dataView(memory0).getUint32(ret + 132, true);
            var len22 = dataView(memory0).getUint32(ret + 136, true);
            var result22 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr22, len22));
            variant23 = result22;
            break;
          }
          default: {
            throw new TypeError('invalid variant discriminant for option');
          }
        }
        let variant25;
        switch (dataView(memory0).getUint8(ret + 140, true)) {
          case 0: {
            variant25 = undefined;
            break;
          }
          case 1: {
            var ptr24 = dataView(memory0).getUint32(ret + 144, true);
            var len24 = dataView(memory0).getUint32(ret + 148, true);
            var result24 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr24, len24));
            variant25 = result24;
            break;
          }
          default: {
            throw new TypeError('invalid variant discriminant for option');
          }
        }
        let variant27;
        switch (dataView(memory0).getUint8(ret + 152, true)) {
          case 0: {
            variant27 = undefined;
            break;
          }
          case 1: {
            var ptr26 = dataView(memory0).getUint32(ret + 156, true);
            var len26 = dataView(memory0).getUint32(ret + 160, true);
            var result26 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr26, len26));
            variant27 = result26;
            break;
          }
          default: {
            throw new TypeError('invalid variant discriminant for option');
          }
        }
        var len29 = dataView(memory0).getUint32(ret + 168, true);
        var base29 = dataView(memory0).getUint32(ret + 164, true);
        var result29 = [];
        for (let i = 0; i < len29; i++) {
          const base = base29 + i * 8;
          var ptr28 = dataView(memory0).getUint32(base + 0, true);
          var len28 = dataView(memory0).getUint32(base + 4, true);
          var result28 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr28, len28));
          result29.push(result28);
        }
        let variant31;
        switch (dataView(memory0).getUint8(ret + 172, true)) {
          case 0: {
            variant31 = undefined;
            break;
          }
          case 1: {
            var ptr30 = dataView(memory0).getUint32(ret + 176, true);
            var len30 = dataView(memory0).getUint32(ret + 180, true);
            var result30 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr30, len30));
            variant31 = result30;
            break;
          }
          default: {
            throw new TypeError('invalid variant discriminant for option');
          }
        }
        var len34 = dataView(memory0).getUint32(ret + 188, true);
        var base34 = dataView(memory0).getUint32(ret + 184, true);
        var result34 = [];
        for (let i = 0; i < len34; i++) {
          const base = base34 + i * 16;
          var ptr32 = dataView(memory0).getUint32(base + 0, true);
          var len32 = dataView(memory0).getUint32(base + 4, true);
          var result32 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr32, len32));
          var ptr33 = dataView(memory0).getUint32(base + 8, true);
          var len33 = dataView(memory0).getUint32(base + 12, true);
          var result33 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr33, len33));
          result34.push([result32, result33]);
        }
        var len36 = dataView(memory0).getUint32(ret + 196, true);
        var base36 = dataView(memory0).getUint32(ret + 192, true);
        var result36 = [];
        for (let i = 0; i < len36; i++) {
          const base = base36 + i * 8;
          var ptr35 = dataView(memory0).getUint32(base + 0, true);
          var len35 = dataView(memory0).getUint32(base + 4, true);
          var result35 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr35, len35));
          result36.push(result35);
        }
        var len38 = dataView(memory0).getUint32(ret + 204, true);
        var base38 = dataView(memory0).getUint32(ret + 200, true);
        var result38 = [];
        for (let i = 0; i < len38; i++) {
          const base = base38 + i * 8;
          var ptr37 = dataView(memory0).getUint32(base + 0, true);
          var len37 = dataView(memory0).getUint32(base + 4, true);
          var result37 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr37, len37));
          result38.push(result37);
        }
        variant40= {
          tag: 'ok',
          val: {
            metadataVersion: result1,
            name: result2,
            version: result3,
            summary: variant5,
            description: variant7,
            descriptionContentType: variant9,
            requiresDist: result11,
            requiresPython: variant13,
            providesExtra: result15,
            author: variant17,
            authorEmail: variant19,
            maintainer: variant21,
            maintainerEmail: variant23,
            license: variant25,
            licenseExpression: variant27,
            classifiers: result29,
            homePage: variant31,
            projectUrls: result34,
            platforms: result36,
            dynamic: result38,
          }
        };
        break;
      }
      case 1: {
        var ptr39 = dataView(memory0).getUint32(ret + 4, true);
        var len39 = dataView(memory0).getUint32(ret + 8, true);
        var result39 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr39, len39));
        variant40= {
          tag: 'err',
          val: result39
        };
        break;
      }
      default: {
        throw new TypeError('invalid variant discriminant for expected');
      }
    }
    _debugLog('[iface="parse-dist-metadata", function="parse-dist-metadata"][Instruction::Return]', {
      funcName: 'parse-dist-metadata',
      paramCount: 1,
      async: false,
      postReturn: true
    });
    const retCopy = variant40;
    
    let cstate = getOrCreateAsyncState(0);
    cstate.mayLeave = false;
    postReturn1(ret);
    cstate.mayLeave = true;
    
    
    
    if (typeof retCopy === 'object' && retCopy.tag === 'err') {
      throw new ComponentError(retCopy.val);
    }
    return retCopy.val;
    
  }
  let exports1ParseRecord;
  
  function parseRecord(arg0) {
    var ptr0 = utf8Encode(arg0, realloc0, memory0);
    var len0 = utf8EncodedLen;
    _debugLog('[iface="parse-record", function="parse-record"][Instruction::CallWasm] enter', {
      funcName: 'parse-record',
      paramCount: 2,
      async: false,
      postReturn: true,
    });
    const _wasm_call_currentTaskID = startCurrentTask(0, false, 'exports1ParseRecord');
    const ret = exports1ParseRecord(ptr0, len0);
    endCurrentTask(0);
    let variant7;
    switch (dataView(memory0).getUint8(ret + 0, true)) {
      case 0: {
        var len5 = dataView(memory0).getUint32(ret + 8, true);
        var base5 = dataView(memory0).getUint32(ret + 4, true);
        var result5 = [];
        for (let i = 0; i < len5; i++) {
          const base = base5 + i * 40;
          var ptr1 = dataView(memory0).getUint32(base + 0, true);
          var len1 = dataView(memory0).getUint32(base + 4, true);
          var result1 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr1, len1));
          let variant3;
          switch (dataView(memory0).getUint8(base + 8, true)) {
            case 0: {
              variant3 = undefined;
              break;
            }
            case 1: {
              var ptr2 = dataView(memory0).getUint32(base + 12, true);
              var len2 = dataView(memory0).getUint32(base + 16, true);
              var result2 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr2, len2));
              variant3 = result2;
              break;
            }
            default: {
              throw new TypeError('invalid variant discriminant for option');
            }
          }
          let variant4;
          switch (dataView(memory0).getUint8(base + 24, true)) {
            case 0: {
              variant4 = undefined;
              break;
            }
            case 1: {
              variant4 = BigInt.asUintN(64, dataView(memory0).getBigInt64(base + 32, true));
              break;
            }
            default: {
              throw new TypeError('invalid variant discriminant for option');
            }
          }
          result5.push({
            path: result1,
            hash: variant3,
            size: variant4,
          });
        }
        variant7= {
          tag: 'ok',
          val: result5
        };
        break;
      }
      case 1: {
        var ptr6 = dataView(memory0).getUint32(ret + 4, true);
        var len6 = dataView(memory0).getUint32(ret + 8, true);
        var result6 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr6, len6));
        variant7= {
          tag: 'err',
          val: result6
        };
        break;
      }
      default: {
        throw new TypeError('invalid variant discriminant for expected');
      }
    }
    _debugLog('[iface="parse-record", function="parse-record"][Instruction::Return]', {
      funcName: 'parse-record',
      paramCount: 1,
      async: false,
      postReturn: true
    });
    const retCopy = variant7;
    
    let cstate = getOrCreateAsyncState(0);
    cstate.mayLeave = false;
    postReturn2(ret);
    cstate.mayLeave = true;
    
    
    
    if (typeof retCopy === 'object' && retCopy.tag === 'err') {
      throw new ComponentError(retCopy.val);
    }
    return retCopy.val;
    
  }
  let exports1ParseDirectUrl;
  
  function parseDirectUrl(arg0) {
    var ptr0 = utf8Encode(arg0, realloc0, memory0);
    var len0 = utf8EncodedLen;
    _debugLog('[iface="parse-direct-url", function="parse-direct-url"][Instruction::CallWasm] enter', {
      funcName: 'parse-direct-url',
      paramCount: 2,
      async: false,
      postReturn: true,
    });
    const _wasm_call_currentTaskID = startCurrentTask(0, false, 'exports1ParseDirectUrl');
    const ret = exports1ParseDirectUrl(ptr0, len0);
    endCurrentTask(0);
    let variant14;
    switch (dataView(memory0).getUint8(ret + 0, true)) {
      case 0: {
        let variant12;
        switch (dataView(memory0).getUint8(ret + 4, true)) {
          case 0: {
            var ptr1 = dataView(memory0).getUint32(ret + 8, true);
            var len1 = dataView(memory0).getUint32(ret + 12, true);
            var result1 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr1, len1));
            var bool2 = dataView(memory0).getUint8(ret + 16, true);
            variant12= {
              tag: 'local-directory',
              val: {
                url: result1,
                editable: bool2 == 0 ? false : (bool2 == 1 ? true : throwInvalidBool()),
              }
            };
            break;
          }
          case 1: {
            var ptr3 = dataView(memory0).getUint32(ret + 8, true);
            var len3 = dataView(memory0).getUint32(ret + 12, true);
            var result3 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr3, len3));
            let variant5;
            switch (dataView(memory0).getUint8(ret + 16, true)) {
              case 0: {
                variant5 = undefined;
                break;
              }
              case 1: {
                var ptr4 = dataView(memory0).getUint32(ret + 20, true);
                var len4 = dataView(memory0).getUint32(ret + 24, true);
                var result4 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr4, len4));
                variant5 = result4;
                break;
              }
              default: {
                throw new TypeError('invalid variant discriminant for option');
              }
            }
            variant12= {
              tag: 'archive',
              val: {
                url: result3,
                hash: variant5,
              }
            };
            break;
          }
          case 2: {
            var ptr6 = dataView(memory0).getUint32(ret + 8, true);
            var len6 = dataView(memory0).getUint32(ret + 12, true);
            var result6 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr6, len6));
            var ptr7 = dataView(memory0).getUint32(ret + 16, true);
            var len7 = dataView(memory0).getUint32(ret + 20, true);
            var result7 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr7, len7));
            let variant9;
            switch (dataView(memory0).getUint8(ret + 24, true)) {
              case 0: {
                variant9 = undefined;
                break;
              }
              case 1: {
                var ptr8 = dataView(memory0).getUint32(ret + 28, true);
                var len8 = dataView(memory0).getUint32(ret + 32, true);
                var result8 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr8, len8));
                variant9 = result8;
                break;
              }
              default: {
                throw new TypeError('invalid variant discriminant for option');
              }
            }
            let variant11;
            switch (dataView(memory0).getUint8(ret + 36, true)) {
              case 0: {
                variant11 = undefined;
                break;
              }
              case 1: {
                var ptr10 = dataView(memory0).getUint32(ret + 40, true);
                var len10 = dataView(memory0).getUint32(ret + 44, true);
                var result10 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr10, len10));
                variant11 = result10;
                break;
              }
              default: {
                throw new TypeError('invalid variant discriminant for option');
              }
            }
            variant12= {
              tag: 'vcs',
              val: {
                url: result6,
                vcs: result7,
                commitId: variant9,
                requestedRevision: variant11,
              }
            };
            break;
          }
          default: {
            throw new TypeError('invalid variant discriminant for DirectUrlInfo');
          }
        }
        variant14= {
          tag: 'ok',
          val: variant12
        };
        break;
      }
      case 1: {
        var ptr13 = dataView(memory0).getUint32(ret + 4, true);
        var len13 = dataView(memory0).getUint32(ret + 8, true);
        var result13 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr13, len13));
        variant14= {
          tag: 'err',
          val: result13
        };
        break;
      }
      default: {
        throw new TypeError('invalid variant discriminant for expected');
      }
    }
    _debugLog('[iface="parse-direct-url", function="parse-direct-url"][Instruction::Return]', {
      funcName: 'parse-direct-url',
      paramCount: 1,
      async: false,
      postReturn: true
    });
    const retCopy = variant14;
    
    let cstate = getOrCreateAsyncState(0);
    cstate.mayLeave = false;
    postReturn3(ret);
    cstate.mayLeave = true;
    
    
    
    if (typeof retCopy === 'object' && retCopy.tag === 'err') {
      throw new ComponentError(retCopy.val);
    }
    return retCopy.val;
    
  }
  let exports1NormalizePackageName;
  
  function normalizePackageName(arg0) {
    var ptr0 = utf8Encode(arg0, realloc0, memory0);
    var len0 = utf8EncodedLen;
    _debugLog('[iface="normalize-package-name", function="normalize-package-name"][Instruction::CallWasm] enter', {
      funcName: 'normalize-package-name',
      paramCount: 2,
      async: false,
      postReturn: true,
    });
    const _wasm_call_currentTaskID = startCurrentTask(0, false, 'exports1NormalizePackageName');
    const ret = exports1NormalizePackageName(ptr0, len0);
    endCurrentTask(0);
    var ptr1 = dataView(memory0).getUint32(ret + 0, true);
    var len1 = dataView(memory0).getUint32(ret + 4, true);
    var result1 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr1, len1));
    _debugLog('[iface="normalize-package-name", function="normalize-package-name"][Instruction::Return]', {
      funcName: 'normalize-package-name',
      paramCount: 1,
      async: false,
      postReturn: true
    });
    const retCopy = result1;
    
    let cstate = getOrCreateAsyncState(0);
    cstate.mayLeave = false;
    postReturn4(ret);
    cstate.mayLeave = true;
    return retCopy;
    
  }
  let exports1ParseRequirementsTxt;
  
  function parseRequirementsTxt(arg0, arg1, arg2) {
    var ptr0 = utf8Encode(arg0, realloc0, memory0);
    var len0 = utf8EncodedLen;
    var variant2 = arg1;
    let variant2_0;
    let variant2_1;
    let variant2_2;
    if (variant2 === null || variant2=== undefined) {
      variant2_0 = 0;
      variant2_1 = 0;
      variant2_2 = 0;
    } else {
      const e = variant2;
      var ptr1 = utf8Encode(e, realloc0, memory0);
      var len1 = utf8EncodedLen;
      variant2_0 = 1;
      variant2_1 = ptr1;
      variant2_2 = len1;
    }
    var variant4 = arg2;
    let variant4_0;
    let variant4_1;
    let variant4_2;
    if (variant4 === null || variant4=== undefined) {
      variant4_0 = 0;
      variant4_1 = 0;
      variant4_2 = 0;
    } else {
      const e = variant4;
      var ptr3 = utf8Encode(e, realloc0, memory0);
      var len3 = utf8EncodedLen;
      variant4_0 = 1;
      variant4_1 = ptr3;
      variant4_2 = len3;
    }
    _debugLog('[iface="parse-requirements-txt", function="parse-requirements-txt"][Instruction::CallWasm] enter', {
      funcName: 'parse-requirements-txt',
      paramCount: 8,
      async: false,
      postReturn: true,
    });
    const _wasm_call_currentTaskID = startCurrentTask(0, false, 'exports1ParseRequirementsTxt');
    const ret = exports1ParseRequirementsTxt(ptr0, len0, variant2_0, variant2_1, variant2_2, variant4_0, variant4_1, variant4_2);
    endCurrentTask(0);
    let variant55;
    switch (dataView(memory0).getUint8(ret + 0, true)) {
      case 0: {
        var len25 = dataView(memory0).getUint32(ret + 8, true);
        var base25 = dataView(memory0).getUint32(ret + 4, true);
        var result25 = [];
        for (let i = 0; i < len25; i++) {
          const base = base25 + i * 112;
          let variant6;
          switch (dataView(memory0).getUint8(base + 0, true)) {
            case 0: {
              variant6 = undefined;
              break;
            }
            case 1: {
              var ptr5 = dataView(memory0).getUint32(base + 4, true);
              var len5 = dataView(memory0).getUint32(base + 8, true);
              var result5 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr5, len5));
              variant6 = result5;
              break;
            }
            default: {
              throw new TypeError('invalid variant discriminant for option');
            }
          }
          var ptr7 = dataView(memory0).getUint32(base + 12, true);
          var len7 = dataView(memory0).getUint32(base + 16, true);
          var result7 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr7, len7));
          var len9 = dataView(memory0).getUint32(base + 24, true);
          var base9 = dataView(memory0).getUint32(base + 20, true);
          var result9 = [];
          for (let i = 0; i < len9; i++) {
            const base = base9 + i * 8;
            var ptr8 = dataView(memory0).getUint32(base + 0, true);
            var len8 = dataView(memory0).getUint32(base + 4, true);
            var result8 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr8, len8));
            result9.push(result8);
          }
          let variant11;
          switch (dataView(memory0).getUint8(base + 28, true)) {
            case 0: {
              variant11 = undefined;
              break;
            }
            case 1: {
              var ptr10 = dataView(memory0).getUint32(base + 32, true);
              var len10 = dataView(memory0).getUint32(base + 36, true);
              var result10 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr10, len10));
              variant11 = result10;
              break;
            }
            default: {
              throw new TypeError('invalid variant discriminant for option');
            }
          }
          let variant13;
          switch (dataView(memory0).getUint8(base + 40, true)) {
            case 0: {
              variant13 = undefined;
              break;
            }
            case 1: {
              var ptr12 = dataView(memory0).getUint32(base + 44, true);
              var len12 = dataView(memory0).getUint32(base + 48, true);
              var result12 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr12, len12));
              variant13 = result12;
              break;
            }
            default: {
              throw new TypeError('invalid variant discriminant for option');
            }
          }
          let variant15;
          switch (dataView(memory0).getUint8(base + 52, true)) {
            case 0: {
              variant15 = undefined;
              break;
            }
            case 1: {
              var ptr14 = dataView(memory0).getUint32(base + 56, true);
              var len14 = dataView(memory0).getUint32(base + 60, true);
              var result14 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr14, len14));
              variant15 = result14;
              break;
            }
            default: {
              throw new TypeError('invalid variant discriminant for option');
            }
          }
          var len17 = dataView(memory0).getUint32(base + 68, true);
          var base17 = dataView(memory0).getUint32(base + 64, true);
          var result17 = [];
          for (let i = 0; i < len17; i++) {
            const base = base17 + i * 8;
            var ptr16 = dataView(memory0).getUint32(base + 0, true);
            var len16 = dataView(memory0).getUint32(base + 4, true);
            var result16 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr16, len16));
            result17.push(result16);
          }
          var bool18 = dataView(memory0).getUint8(base + 72, true);
          let variant22;
          switch (dataView(memory0).getUint8(base + 76, true)) {
            case 0: {
              variant22 = undefined;
              break;
            }
            case 1: {
              var ptr19 = dataView(memory0).getUint32(base + 80, true);
              var len19 = dataView(memory0).getUint32(base + 84, true);
              var result19 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr19, len19));
              let variant21;
              switch (dataView(memory0).getUint8(base + 88, true)) {
                case 0: {
                  variant21 = undefined;
                  break;
                }
                case 1: {
                  var ptr20 = dataView(memory0).getUint32(base + 92, true);
                  var len20 = dataView(memory0).getUint32(base + 96, true);
                  var result20 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr20, len20));
                  variant21 = result20;
                  break;
                }
                default: {
                  throw new TypeError('invalid variant discriminant for option');
                }
              }
              variant22 = {
                url: result19,
                rev: variant21,
              };
              break;
            }
            default: {
              throw new TypeError('invalid variant discriminant for option');
            }
          }
          let variant24;
          switch (dataView(memory0).getUint8(base + 100, true)) {
            case 0: {
              variant24 = undefined;
              break;
            }
            case 1: {
              var ptr23 = dataView(memory0).getUint32(base + 104, true);
              var len23 = dataView(memory0).getUint32(base + 108, true);
              var result23 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr23, len23));
              variant24 = result23;
              break;
            }
            default: {
              throw new TypeError('invalid variant discriminant for option');
            }
          }
          result25.push({
            name: variant6,
            pep508: result7,
            extras: result9,
            markers: variant11,
            versionSpec: variant13,
            url: variant15,
            hashes: result17,
            editable: bool18 == 0 ? false : (bool18 == 1 ? true : throwInvalidBool()),
            vcs: variant22,
            givenUrl: variant24,
          });
        }
        var len46 = dataView(memory0).getUint32(ret + 16, true);
        var base46 = dataView(memory0).getUint32(ret + 12, true);
        var result46 = [];
        for (let i = 0; i < len46; i++) {
          const base = base46 + i * 112;
          let variant27;
          switch (dataView(memory0).getUint8(base + 0, true)) {
            case 0: {
              variant27 = undefined;
              break;
            }
            case 1: {
              var ptr26 = dataView(memory0).getUint32(base + 4, true);
              var len26 = dataView(memory0).getUint32(base + 8, true);
              var result26 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr26, len26));
              variant27 = result26;
              break;
            }
            default: {
              throw new TypeError('invalid variant discriminant for option');
            }
          }
          var ptr28 = dataView(memory0).getUint32(base + 12, true);
          var len28 = dataView(memory0).getUint32(base + 16, true);
          var result28 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr28, len28));
          var len30 = dataView(memory0).getUint32(base + 24, true);
          var base30 = dataView(memory0).getUint32(base + 20, true);
          var result30 = [];
          for (let i = 0; i < len30; i++) {
            const base = base30 + i * 8;
            var ptr29 = dataView(memory0).getUint32(base + 0, true);
            var len29 = dataView(memory0).getUint32(base + 4, true);
            var result29 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr29, len29));
            result30.push(result29);
          }
          let variant32;
          switch (dataView(memory0).getUint8(base + 28, true)) {
            case 0: {
              variant32 = undefined;
              break;
            }
            case 1: {
              var ptr31 = dataView(memory0).getUint32(base + 32, true);
              var len31 = dataView(memory0).getUint32(base + 36, true);
              var result31 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr31, len31));
              variant32 = result31;
              break;
            }
            default: {
              throw new TypeError('invalid variant discriminant for option');
            }
          }
          let variant34;
          switch (dataView(memory0).getUint8(base + 40, true)) {
            case 0: {
              variant34 = undefined;
              break;
            }
            case 1: {
              var ptr33 = dataView(memory0).getUint32(base + 44, true);
              var len33 = dataView(memory0).getUint32(base + 48, true);
              var result33 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr33, len33));
              variant34 = result33;
              break;
            }
            default: {
              throw new TypeError('invalid variant discriminant for option');
            }
          }
          let variant36;
          switch (dataView(memory0).getUint8(base + 52, true)) {
            case 0: {
              variant36 = undefined;
              break;
            }
            case 1: {
              var ptr35 = dataView(memory0).getUint32(base + 56, true);
              var len35 = dataView(memory0).getUint32(base + 60, true);
              var result35 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr35, len35));
              variant36 = result35;
              break;
            }
            default: {
              throw new TypeError('invalid variant discriminant for option');
            }
          }
          var len38 = dataView(memory0).getUint32(base + 68, true);
          var base38 = dataView(memory0).getUint32(base + 64, true);
          var result38 = [];
          for (let i = 0; i < len38; i++) {
            const base = base38 + i * 8;
            var ptr37 = dataView(memory0).getUint32(base + 0, true);
            var len37 = dataView(memory0).getUint32(base + 4, true);
            var result37 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr37, len37));
            result38.push(result37);
          }
          var bool39 = dataView(memory0).getUint8(base + 72, true);
          let variant43;
          switch (dataView(memory0).getUint8(base + 76, true)) {
            case 0: {
              variant43 = undefined;
              break;
            }
            case 1: {
              var ptr40 = dataView(memory0).getUint32(base + 80, true);
              var len40 = dataView(memory0).getUint32(base + 84, true);
              var result40 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr40, len40));
              let variant42;
              switch (dataView(memory0).getUint8(base + 88, true)) {
                case 0: {
                  variant42 = undefined;
                  break;
                }
                case 1: {
                  var ptr41 = dataView(memory0).getUint32(base + 92, true);
                  var len41 = dataView(memory0).getUint32(base + 96, true);
                  var result41 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr41, len41));
                  variant42 = result41;
                  break;
                }
                default: {
                  throw new TypeError('invalid variant discriminant for option');
                }
              }
              variant43 = {
                url: result40,
                rev: variant42,
              };
              break;
            }
            default: {
              throw new TypeError('invalid variant discriminant for option');
            }
          }
          let variant45;
          switch (dataView(memory0).getUint8(base + 100, true)) {
            case 0: {
              variant45 = undefined;
              break;
            }
            case 1: {
              var ptr44 = dataView(memory0).getUint32(base + 104, true);
              var len44 = dataView(memory0).getUint32(base + 108, true);
              var result44 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr44, len44));
              variant45 = result44;
              break;
            }
            default: {
              throw new TypeError('invalid variant discriminant for option');
            }
          }
          result46.push({
            name: variant27,
            pep508: result28,
            extras: result30,
            markers: variant32,
            versionSpec: variant34,
            url: variant36,
            hashes: result38,
            editable: bool39 == 0 ? false : (bool39 == 1 ? true : throwInvalidBool()),
            vcs: variant43,
            givenUrl: variant45,
          });
        }
        let variant48;
        switch (dataView(memory0).getUint8(ret + 20, true)) {
          case 0: {
            variant48 = undefined;
            break;
          }
          case 1: {
            var ptr47 = dataView(memory0).getUint32(ret + 24, true);
            var len47 = dataView(memory0).getUint32(ret + 28, true);
            var result47 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr47, len47));
            variant48 = result47;
            break;
          }
          default: {
            throw new TypeError('invalid variant discriminant for option');
          }
        }
        var len50 = dataView(memory0).getUint32(ret + 36, true);
        var base50 = dataView(memory0).getUint32(ret + 32, true);
        var result50 = [];
        for (let i = 0; i < len50; i++) {
          const base = base50 + i * 8;
          var ptr49 = dataView(memory0).getUint32(base + 0, true);
          var len49 = dataView(memory0).getUint32(base + 4, true);
          var result49 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr49, len49));
          result50.push(result49);
        }
        var len52 = dataView(memory0).getUint32(ret + 44, true);
        var base52 = dataView(memory0).getUint32(ret + 40, true);
        var result52 = [];
        for (let i = 0; i < len52; i++) {
          const base = base52 + i * 8;
          var ptr51 = dataView(memory0).getUint32(base + 0, true);
          var len51 = dataView(memory0).getUint32(base + 4, true);
          var result51 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr51, len51));
          result52.push(result51);
        }
        var bool53 = dataView(memory0).getUint8(ret + 48, true);
        variant55= {
          tag: 'ok',
          val: {
            requirements: result25,
            editables: result46,
            indexUrl: variant48,
            extraIndexUrls: result50,
            findLinks: result52,
            noIndex: bool53 == 0 ? false : (bool53 == 1 ? true : throwInvalidBool()),
          }
        };
        break;
      }
      case 1: {
        var ptr54 = dataView(memory0).getUint32(ret + 4, true);
        var len54 = dataView(memory0).getUint32(ret + 8, true);
        var result54 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr54, len54));
        variant55= {
          tag: 'err',
          val: result54
        };
        break;
      }
      default: {
        throw new TypeError('invalid variant discriminant for expected');
      }
    }
    _debugLog('[iface="parse-requirements-txt", function="parse-requirements-txt"][Instruction::Return]', {
      funcName: 'parse-requirements-txt',
      paramCount: 1,
      async: false,
      postReturn: true
    });
    const retCopy = variant55;
    
    let cstate = getOrCreateAsyncState(0);
    cstate.mayLeave = false;
    postReturn5(ret);
    cstate.mayLeave = true;
    
    
    
    if (typeof retCopy === 'object' && retCopy.tag === 'err') {
      throw new ComponentError(retCopy.val);
    }
    return retCopy.val;
    
  }
  let exports1ParsePep508;
  
  function parsePep508(arg0) {
    var ptr0 = utf8Encode(arg0, realloc0, memory0);
    var len0 = utf8EncodedLen;
    _debugLog('[iface="parse-pep508", function="parse-pep508"][Instruction::CallWasm] enter', {
      funcName: 'parse-pep508',
      paramCount: 2,
      async: false,
      postReturn: true,
    });
    const _wasm_call_currentTaskID = startCurrentTask(0, false, 'exports1ParsePep508');
    const ret = exports1ParsePep508(ptr0, len0);
    endCurrentTask(0);
    let variant22;
    switch (dataView(memory0).getUint8(ret + 0, true)) {
      case 0: {
        let variant2;
        switch (dataView(memory0).getUint8(ret + 4, true)) {
          case 0: {
            variant2 = undefined;
            break;
          }
          case 1: {
            var ptr1 = dataView(memory0).getUint32(ret + 8, true);
            var len1 = dataView(memory0).getUint32(ret + 12, true);
            var result1 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr1, len1));
            variant2 = result1;
            break;
          }
          default: {
            throw new TypeError('invalid variant discriminant for option');
          }
        }
        var ptr3 = dataView(memory0).getUint32(ret + 16, true);
        var len3 = dataView(memory0).getUint32(ret + 20, true);
        var result3 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr3, len3));
        var len5 = dataView(memory0).getUint32(ret + 28, true);
        var base5 = dataView(memory0).getUint32(ret + 24, true);
        var result5 = [];
        for (let i = 0; i < len5; i++) {
          const base = base5 + i * 8;
          var ptr4 = dataView(memory0).getUint32(base + 0, true);
          var len4 = dataView(memory0).getUint32(base + 4, true);
          var result4 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr4, len4));
          result5.push(result4);
        }
        let variant7;
        switch (dataView(memory0).getUint8(ret + 32, true)) {
          case 0: {
            variant7 = undefined;
            break;
          }
          case 1: {
            var ptr6 = dataView(memory0).getUint32(ret + 36, true);
            var len6 = dataView(memory0).getUint32(ret + 40, true);
            var result6 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr6, len6));
            variant7 = result6;
            break;
          }
          default: {
            throw new TypeError('invalid variant discriminant for option');
          }
        }
        let variant9;
        switch (dataView(memory0).getUint8(ret + 44, true)) {
          case 0: {
            variant9 = undefined;
            break;
          }
          case 1: {
            var ptr8 = dataView(memory0).getUint32(ret + 48, true);
            var len8 = dataView(memory0).getUint32(ret + 52, true);
            var result8 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr8, len8));
            variant9 = result8;
            break;
          }
          default: {
            throw new TypeError('invalid variant discriminant for option');
          }
        }
        let variant11;
        switch (dataView(memory0).getUint8(ret + 56, true)) {
          case 0: {
            variant11 = undefined;
            break;
          }
          case 1: {
            var ptr10 = dataView(memory0).getUint32(ret + 60, true);
            var len10 = dataView(memory0).getUint32(ret + 64, true);
            var result10 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr10, len10));
            variant11 = result10;
            break;
          }
          default: {
            throw new TypeError('invalid variant discriminant for option');
          }
        }
        var len13 = dataView(memory0).getUint32(ret + 72, true);
        var base13 = dataView(memory0).getUint32(ret + 68, true);
        var result13 = [];
        for (let i = 0; i < len13; i++) {
          const base = base13 + i * 8;
          var ptr12 = dataView(memory0).getUint32(base + 0, true);
          var len12 = dataView(memory0).getUint32(base + 4, true);
          var result12 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr12, len12));
          result13.push(result12);
        }
        var bool14 = dataView(memory0).getUint8(ret + 76, true);
        let variant18;
        switch (dataView(memory0).getUint8(ret + 80, true)) {
          case 0: {
            variant18 = undefined;
            break;
          }
          case 1: {
            var ptr15 = dataView(memory0).getUint32(ret + 84, true);
            var len15 = dataView(memory0).getUint32(ret + 88, true);
            var result15 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr15, len15));
            let variant17;
            switch (dataView(memory0).getUint8(ret + 92, true)) {
              case 0: {
                variant17 = undefined;
                break;
              }
              case 1: {
                var ptr16 = dataView(memory0).getUint32(ret + 96, true);
                var len16 = dataView(memory0).getUint32(ret + 100, true);
                var result16 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr16, len16));
                variant17 = result16;
                break;
              }
              default: {
                throw new TypeError('invalid variant discriminant for option');
              }
            }
            variant18 = {
              url: result15,
              rev: variant17,
            };
            break;
          }
          default: {
            throw new TypeError('invalid variant discriminant for option');
          }
        }
        let variant20;
        switch (dataView(memory0).getUint8(ret + 104, true)) {
          case 0: {
            variant20 = undefined;
            break;
          }
          case 1: {
            var ptr19 = dataView(memory0).getUint32(ret + 108, true);
            var len19 = dataView(memory0).getUint32(ret + 112, true);
            var result19 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr19, len19));
            variant20 = result19;
            break;
          }
          default: {
            throw new TypeError('invalid variant discriminant for option');
          }
        }
        variant22= {
          tag: 'ok',
          val: {
            name: variant2,
            pep508: result3,
            extras: result5,
            markers: variant7,
            versionSpec: variant9,
            url: variant11,
            hashes: result13,
            editable: bool14 == 0 ? false : (bool14 == 1 ? true : throwInvalidBool()),
            vcs: variant18,
            givenUrl: variant20,
          }
        };
        break;
      }
      case 1: {
        var ptr21 = dataView(memory0).getUint32(ret + 4, true);
        var len21 = dataView(memory0).getUint32(ret + 8, true);
        var result21 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr21, len21));
        variant22= {
          tag: 'err',
          val: result21
        };
        break;
      }
      default: {
        throw new TypeError('invalid variant discriminant for expected');
      }
    }
    _debugLog('[iface="parse-pep508", function="parse-pep508"][Instruction::Return]', {
      funcName: 'parse-pep508',
      paramCount: 1,
      async: false,
      postReturn: true
    });
    const retCopy = variant22;
    
    let cstate = getOrCreateAsyncState(0);
    cstate.mayLeave = false;
    postReturn6(ret);
    cstate.mayLeave = true;
    
    
    
    if (typeof retCopy === 'object' && retCopy.tag === 'err') {
      throw new ComponentError(retCopy.val);
    }
    return retCopy.val;
    
  }
  let exports1IsWheelCompatible;
  
  function isWheelCompatible(arg0, arg1, arg2, arg3, arg4, arg5, arg6) {
    var ptr0 = utf8Encode(arg0, realloc0, memory0);
    var len0 = utf8EncodedLen;
    var ptr1 = utf8Encode(arg3, realloc0, memory0);
    var len1 = utf8EncodedLen;
    var ptr2 = utf8Encode(arg4, realloc0, memory0);
    var len2 = utf8EncodedLen;
    _debugLog('[iface="is-wheel-compatible", function="is-wheel-compatible"][Instruction::CallWasm] enter', {
      funcName: 'is-wheel-compatible',
      paramCount: 10,
      async: false,
      postReturn: true,
    });
    const _wasm_call_currentTaskID = startCurrentTask(0, false, 'exports1IsWheelCompatible');
    const ret = exports1IsWheelCompatible(ptr0, len0, toUint8(arg1), toUint8(arg2), ptr1, len1, ptr2, len2, toUint16(arg5), toUint16(arg6));
    endCurrentTask(0);
    let variant5;
    switch (dataView(memory0).getUint8(ret + 0, true)) {
      case 0: {
        var bool3 = dataView(memory0).getUint8(ret + 4, true);
        variant5= {
          tag: 'ok',
          val: bool3 == 0 ? false : (bool3 == 1 ? true : throwInvalidBool())
        };
        break;
      }
      case 1: {
        var ptr4 = dataView(memory0).getUint32(ret + 4, true);
        var len4 = dataView(memory0).getUint32(ret + 8, true);
        var result4 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr4, len4));
        variant5= {
          tag: 'err',
          val: result4
        };
        break;
      }
      default: {
        throw new TypeError('invalid variant discriminant for expected');
      }
    }
    _debugLog('[iface="is-wheel-compatible", function="is-wheel-compatible"][Instruction::Return]', {
      funcName: 'is-wheel-compatible',
      paramCount: 1,
      async: false,
      postReturn: true
    });
    const retCopy = variant5;
    
    let cstate = getOrCreateAsyncState(0);
    cstate.mayLeave = false;
    postReturn0(ret);
    cstate.mayLeave = true;
    
    
    
    if (typeof retCopy === 'object' && retCopy.tag === 'err') {
      throw new ComponentError(retCopy.val);
    }
    return retCopy.val;
    
  }
  let exports1EvaluateMarker;
  
  function evaluateMarker(arg0, arg1, arg2, arg3, arg4) {
    var ptr0 = utf8Encode(arg0, realloc0, memory0);
    var len0 = utf8EncodedLen;
    var ptr1 = utf8Encode(arg3, realloc0, memory0);
    var len1 = utf8EncodedLen;
    var ptr2 = utf8Encode(arg4, realloc0, memory0);
    var len2 = utf8EncodedLen;
    _debugLog('[iface="evaluate-marker", function="evaluate-marker"][Instruction::CallWasm] enter', {
      funcName: 'evaluate-marker',
      paramCount: 8,
      async: false,
      postReturn: true,
    });
    const _wasm_call_currentTaskID = startCurrentTask(0, false, 'exports1EvaluateMarker');
    const ret = exports1EvaluateMarker(ptr0, len0, toUint8(arg1), toUint8(arg2), ptr1, len1, ptr2, len2);
    endCurrentTask(0);
    let variant5;
    switch (dataView(memory0).getUint8(ret + 0, true)) {
      case 0: {
        var bool3 = dataView(memory0).getUint8(ret + 4, true);
        variant5= {
          tag: 'ok',
          val: bool3 == 0 ? false : (bool3 == 1 ? true : throwInvalidBool())
        };
        break;
      }
      case 1: {
        var ptr4 = dataView(memory0).getUint32(ret + 4, true);
        var len4 = dataView(memory0).getUint32(ret + 8, true);
        var result4 = utf8Decoder.decode(new Uint8Array(memory0.buffer, ptr4, len4));
        variant5= {
          tag: 'err',
          val: result4
        };
        break;
      }
      default: {
        throw new TypeError('invalid variant discriminant for expected');
      }
    }
    _debugLog('[iface="evaluate-marker", function="evaluate-marker"][Instruction::Return]', {
      funcName: 'evaluate-marker',
      paramCount: 1,
      async: false,
      postReturn: true
    });
    const retCopy = variant5;
    
    let cstate = getOrCreateAsyncState(0);
    cstate.mayLeave = false;
    postReturn0(ret);
    cstate.mayLeave = true;
    
    
    
    if (typeof retCopy === 'object' && retCopy.tag === 'err') {
      throw new ComponentError(retCopy.val);
    }
    return retCopy.val;
    
  }
  exports1FindAppOrHandler = exports1['find-app-or-handler'];
  exports1GetStringConstant = exports1['get-string-constant'];
  exports1ContainsTopLevelCallable = exports1['contains-top-level-callable'];
  exports1ParseDistMetadata = exports1['parse-dist-metadata'];
  exports1ParseRecord = exports1['parse-record'];
  exports1ParseDirectUrl = exports1['parse-direct-url'];
  exports1NormalizePackageName = exports1['normalize-package-name'];
  exports1ParseRequirementsTxt = exports1['parse-requirements-txt'];
  exports1ParsePep508 = exports1['parse-pep508'];
  exports1IsWheelCompatible = exports1['is-wheel-compatible'];
  exports1EvaluateMarker = exports1['evaluate-marker'];
  
  return { containsTopLevelCallable, evaluateMarker, findAppOrHandler, getStringConstant, isWheelCompatible, normalizePackageName, parseDirectUrl, parseDistMetadata, parsePep508, parseRecord, parseRequirementsTxt,  };
})();
let promise, resolve, reject;
function runNext (value) {
  try {
    let done;
    do {
      ({ value, done } = gen.next(value));
    } while (!(value instanceof Promise) && !done);
    if (done) {
      if (resolve) return resolve(value);
      else return value;
    }
    if (!promise) promise = new Promise((_resolve, _reject) => (resolve = _resolve, reject = _reject));
    value.then(nextVal => done ? resolve() : runNext(nextVal), reject);
  }
  catch (e) {
    if (reject) reject(e);
    else throw e;
  }
}
const maybeSyncReturn = runNext(null);
return promise || maybeSyncReturn;
}
