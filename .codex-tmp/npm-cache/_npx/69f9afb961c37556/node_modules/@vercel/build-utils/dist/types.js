"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var types_exports = {};
__export(types_exports, {
  BunVersion: () => BunVersion,
  JOB_TRIGGERS: () => JOB_TRIGGERS,
  NodeVersion: () => NodeVersion,
  Version: () => Version,
  getServiceQueueTopicConfigs: () => getServiceQueueTopicConfigs,
  getServiceQueueTopics: () => getServiceQueueTopics,
  isQueueTriggeredService: () => isQueueTriggeredService,
  isScheduleTriggeredService: () => isScheduleTriggeredService
});
module.exports = __toCommonJS(types_exports);
class Version {
  constructor(version) {
    this.major = version.major;
    this.minor = version.minor;
    this.range = version.range;
    this.runtime = version.runtime;
    this.discontinueDate = version.discontinueDate;
  }
  get state() {
    if (this.discontinueDate && this.discontinueDate.getTime() <= Date.now()) {
      return "discontinued";
    } else if (this.discontinueDate) {
      return "deprecated";
    }
    return "active";
  }
  get formattedDate() {
    return this.discontinueDate && this.discontinueDate.toISOString().split("T")[0];
  }
}
class NodeVersion extends Version {
}
class BunVersion extends Version {
}
const JOB_TRIGGERS = ["queue", "schedule", "workflow"];
function getServiceQueueTopicConfigs(config) {
  if (Array.isArray(config.topics) && config.topics.length > 0) {
    return typeof config.topics[0] === "string" ? config.topics.map((topic) => ({ topic })) : config.topics;
  }
  return config.type === "worker" ? [{ topic: "default" }] : [];
}
function getServiceQueueTopics(config) {
  return getServiceQueueTopicConfigs(config).map((topic) => topic.topic);
}
function isQueueTriggeredService(service) {
  return service.type === "worker" || service.type === "job" && service.trigger === "queue";
}
function isScheduleTriggeredService(service) {
  return service.type === "cron" || service.type === "job" && service.trigger === "schedule";
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BunVersion,
  JOB_TRIGGERS,
  NodeVersion,
  Version,
  getServiceQueueTopicConfigs,
  getServiceQueueTopics,
  isQueueTriggeredService,
  isScheduleTriggeredService
});
