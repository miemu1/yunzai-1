import plugin from "../../../lib/plugins/plugin.js";
import Wallet from "../model/wallet.js";
import GameDB from "../model/gamedb.js";

export class wallet extends plugin {
  constructor(e) {
    super({
      name: "钱包管理",
      dsc: "小游戏金币钱包",
      event: "message.group",
      priority: 500,
      rule: [
        {
          reg: "^钱包$",
          fnc: "balance",
        },
        {
          reg: "^(五子棋|21点|斗牛)签到$",
          fnc: "sign",
        },
        {
          reg: "^加金币\\s*(\\d+)?$",
          fnc: "addCoins",
        },
        {
          reg: "^扣金币\\s*(\\d+)?$",
          fnc: "deductCoins",
        },
        {
          reg: "^金币榜$",
          fnc: "rank",
        },
      ],
    });
  }

async balance() {
  const w = new Wallet(this.e);
  const bal = await w.getBalance();
  const uid = this.e.user_id;
  const nick = this.e.sender.card || this.e.nickname || uid;

  this.e.reply(
    `💼【钱包查询】\n` +
    `────────────────\n` +
    `👤 用户：${nick}\n` +
    `💰 金币余额：${bal} 金币\n` +
    `────────────────\n` +
    `📢 获取金币方式：\n` +
    `👉 发送 “斗牛签到” 即可获取金币哦~\n` +
    `👉 发送 “斗牛” 指令参与小游戏~\n` +
    `👉 发送 “金币榜” 查看富哥吧！\n` +
    `🎁 赢取金币，冲上排行榜！`
  );
}

  async sign() {
    const lastKey = `Yz:sign:${this.e.user_id}`;
    const last = await redis.get(lastKey);
    const now = Date.now();
    if (last && now - parseInt(last) < 3600 * 1000) {
      this.e.reply("距离上次签到未满1小时，无法领取");
      return;
    }
    const w = new Wallet(this.e);
    await w.add(10000);
    await redis.set(lastKey, now);
    const bal = await w.getBalance();
    this.e.reply(`签到成功，获得10000金币，当前余额：${bal}`);
  }

  /** 管理员加金币 */
  async addCoins() {
    if (this.e.user_id !== 1334785643) return false;
    const target = this.e.message.find((m) => m.type === "at")?.qq || this.e.user_id;
    const num = parseInt(this.e.msg.replace(/[^0-9]/g, ""));
    if (!num) {
      this.e.reply("未指定金额");
      return;
    }
    const w = new Wallet({ user_id: target });
    await w.add(num);
    const bal = await w.getBalance();
    this.e.reply(`已为${target}增加${num}金币，当前余额：${bal}`);
  }

  /** 管理员扣金币 */
  async deductCoins() {
    if (this.e.user_id !== 1334785643) return false;
    const target = this.e.message.find((m) => m.type === "at")?.qq || this.e.user_id;
    const num = parseInt(this.e.msg.replace(/[^0-9]/g, ""));
    if (!num) {
      this.e.reply("未指定金额");
      return;
    }
    const w = new Wallet({ user_id: target });
    const ok = await w.deduct(num);
    if (!ok) {
      this.e.reply("余额不足，扣除失败");
      return;
    }
    const bal = await w.getBalance();
    this.e.reply(`已扣除${target}的${num}金币，当前余额：${bal}`);
  }

  async rank() {
    const top = await GameDB.getTopCoins(10);
    const alias = {
      bot_spring: "春",
      bot_summer: "夏",
      bot_autumn: "秋",
      bot_winter: "冬",
    };
    let msg = "🏅 金币排行榜:\n";
    top.forEach((p, i) => {
      const name = alias[p.user_id] || p.user_id;
      msg += `${i + 1}. ${name}：${p.coins} 金币\n`;
    });
    this.e.reply(msg.trim());
  }
}