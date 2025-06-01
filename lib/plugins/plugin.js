export default class plugin {
  constructor({ name = '', dsc = '', event = '', priority = 0, rule = [], task = {} } = {}) {
    this.name = name;
    this.dsc = dsc;
    this.event = event;
    this.priority = priority;
    this.rule = rule;
    // 默认定时任务配置，避免加载器读取属性时报错
    this.task = {
      cron: task.cron || '',
      name: task.name || '',
      fnc: task.fnc || null,
      log: task.log || false,
    };
    this.e = null;
  }

  async accept(e) {
    this.e = e;
    for (const r of this.rule) {
      const reg = new RegExp(r.reg);
      if (reg.test(e.msg)) {
        const fn = typeof r.fnc === 'string' ? this[r.fnc] : r.fnc;
        if (typeof fn === 'function') {
          return await fn.call(this, e);
        }
      }
    }
  }

  reply(msg) {
    if (this.e && typeof this.e.reply === 'function') {
      return this.e.reply(msg);
    }
  }
}