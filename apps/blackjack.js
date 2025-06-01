// blackjack.js - 修复胜率统计显示的版本

import plugin from "../../../lib/plugins/plugin.js";
import { segment } from "oicq";
import GameDB from "../model/gamedb.js";

let blackjaceState = {};
let count = {};
let gameing = {};
const robots = [
  { name: "春", id: "bot_spring" },
  { name: "夏", id: "bot_summer" },
  { name: "秋", id: "bot_autumn" },
  { name: "冬", id: "bot_winter" },
];
let blackjackTimer = {};
let cards = {};

export class blackjack extends plugin {
  constructor(e) {
    super({
      name: "21点",
      dsc: "21点小游戏",
      event: "message.group",
      priority: 500,
      rule: [
        { reg: "^#*21(点)?(\\s*\\d+)?$", fnc: "startBlackjack" },
        { reg: "^(#)?叫牌$", fnc: "deal" },
        { reg: "^(#)?停牌$", fnc: "stop" },
      ],
    });
  }

  get grpKey() {
    return `Yz:bjgroup_id:${this.e.user_id}`;
  }

  async startBlackjack() {
    await this.getGroupId();
    if (!this.group_id) return;

    const betStr = this.e.msg.replace(/#|21点|21/gi, "").trim();
    let bet = parseInt(betStr);
    if (isNaN(bet) || bet <= 0) bet = 1000;

    const Wallet = (await import("../model/wallet.js")).default;
    const w = new Wallet(this.e);
    const bal = await w.getBalance();
    if (bal < bet) return this.e.reply("金币不足，无法开始21点");

    if (!gameing[this.group_id]) gameing[this.group_id] = {};
    if (gameing[this.group_id].self) return this.e.reply("游戏正在进行中");

    this.initArray();
    gameing[this.group_id].self = {
      user_id: this.e.sender.user_id,
      nick: this.e.sender.card || this.e.user_id,
      wallet: w,
    };

    const robot = robots[Math.floor(Math.random() * robots.length)];
    const robotWallet = new Wallet({ user_id: robot.id });
    await GameDB.getCoins(robot.id);
    gameing[this.group_id].enemy = {
      user_id: robot.id,
      nick: robot.name,
      robot: true,
      wallet: robotWallet,
    };
    gameing[this.group_id].bet = bet;
    blackjaceState[this.group_id][robot.id] = [];
    blackjaceState[this.group_id][this.e.sender.user_id] = [];

    this.drawCard(this.e.sender.user_id);
    while (this.getPoint(blackjaceState[this.group_id][robot.id]) < 18) {
      this.drawCard(robot.id);
    }

    count[this.group_id] = 1;
    const message = [
      `🎮 ${this.e.sender.card || this.e.user_id} 发起了 21点 对局！`,
      `🤖 对手：${robot.name}`,
      `💰 下注金额：${bet} 金币`,
      `\n发送“叫牌”开始要牌，或发送“停牌”结束回合`,
    ];

    blackjackTimer[this.group_id] && clearTimeout(blackjackTimer[this.group_id]);
    blackjackTimer[this.group_id] = setTimeout(() => {
      gameing[this.group_id] = {};
      count[this.group_id] = 0;
      blackjaceState[this.group_id] = {};
      this.e.reply("⚠️ 对战超时，游戏已结束");
    }, 1000 * 60 * 3);

    this.e.reply(message.join("\n"));
  }

  drawCard(userId) {
    const deck = cards[this.group_id];
    const index = Math.floor(Math.random() * deck.length);
    const card = deck.splice(index, 1)[0];
    blackjaceState[this.group_id][userId].push(card);
  }

  async deal() {
    await this.getGroupId();
    if (!this.group_id || !gameing[this.group_id]?.self) return this.e.reply("没有进行中的21点游戏");

    const userId = this.e.sender.user_id;
    this.drawCard(userId);
    const playerPoint = this.getPoint(blackjaceState[this.group_id][userId]);

    if (playerPoint > 21) return this.endGame("爆掉");

    let msg = this.formatGameState();
    msg += `\n\n👉 当前 ${playerPoint} 点。继续请发送“叫牌”，结束请发送“停牌”`;

    this.resetTimer();
    this.e.reply(msg);
  }

  async stop() {
    await this.getGroupId();
    if (!this.group_id || !gameing[this.group_id]?.self) return this.e.reply("没有进行中的21点游戏");

    const self = gameing[this.group_id].self;
    const enemy = gameing[this.group_id].enemy;
    const selfPoint = this.getPoint(blackjaceState[this.group_id][self.user_id]);
    const enemyPoint = this.getPoint(blackjaceState[this.group_id][enemy.user_id]);

    let result = "平局";
    if (selfPoint > 21) result = "爆掉";
    else if (enemyPoint > 21 || selfPoint > enemyPoint) result = self;
    else if (enemyPoint > selfPoint) result = enemy;

    await this.settleResult(result);
  }

  formatGameState() {
    const state = blackjaceState[this.group_id];
    const self = gameing[this.group_id].self;
    const enemy = gameing[this.group_id].enemy;

    let msg = "📋 当前牌局：\n";
    msg += `👤 ${self.nick}：` + this.cardList(state[self.user_id]) + ` = ${this.getPoint(state[self.user_id])} 点\n`;
    msg += `🤖 ${enemy.nick}：` + this.cardList(state[enemy.user_id]) + ` = ${this.getPoint(state[enemy.user_id])} 点\n`;
    return msg;
  }

  cardList(cards) {
    return cards.map(c => `${c[0]}${c[1]}`).join(" + ");
  }

  getPoint(cards) {
    let point = 0;
    let aceCount = 0;
    for (let card of cards) {
      let val = card[1];
      if (val === "A") {
        aceCount++;
        point += 11;
      } else if (["J", "Q", "K"].includes(val)) {
        point += 10;
      } else {
        point += Number(val);
      }
    }
    while (point > 21 && aceCount > 0) {
      point -= 10;
      aceCount--;
    }
    return point;
  }

  async settleResult(winner) {
    const bet = gameing[this.group_id].bet;
    const self = gameing[this.group_id].self;
    const enemy = gameing[this.group_id].enemy;
    let msg = this.formatGameState();
    let resultMsg = "";

    const selfPoint = this.getPoint(blackjaceState[this.group_id][self.user_id]);
    const enemyPoint = this.getPoint(blackjaceState[this.group_id][enemy.user_id]);

    if (winner === "爆掉") {
      const loser = self.user_id === this.e.user_id ? self : enemy;
      const winnerPlayer = loser.user_id === self.user_id ? enemy : self;
      await this.transferCoins(winnerPlayer, loser, 1);
      resultMsg = `💥 ${loser.nick} 爆掉，${winnerPlayer.nick} 获胜！`;
    } else if (winner === "平局") {
      await self.wallet.add(bet);
      await enemy.wallet.add(bet);
      await GameDB.updateBlackjack(self.user_id, false);
      await GameDB.updateBlackjack(enemy.user_id, false);
      resultMsg = "⚖️ 平局，返还双方下注金币";
    } else {
      let multiplier = (this.getPoint(blackjaceState[this.group_id][winner.user_id]) === 21) ? 5 : 1;
      await this.transferCoins(winner, winner.user_id === self.user_id ? enemy : self, multiplier);
      resultMsg = `🎉 ${winner.nick} 获胜，获得 ${bet * multiplier} 金币！`;
    }

    const sbal = await self.wallet.getBalance();
    const ebal = await enemy.wallet.getBalance();

    const sStats = await GameDB.getStats?.(self.user_id, "blackjack");
    const eStats = await GameDB.getStats?.(enemy.user_id, "blackjack");
    const sWin = sStats?.win || 0;
    const sTotal = sStats?.total || 0;
    const eWin = eStats?.win || 0;
    const eTotal = eStats?.total || 0;

    msg += `\n📈 玩家余额：${sbal} 金币｜胜率：${sTotal ? ((sWin/sTotal)*100).toFixed(1) : 0}% (${sWin}/${sTotal})`;
    msg += `\n📉 机器人余额：${ebal} 金币｜胜率：${eTotal ? ((eWin/eTotal)*100).toFixed(1) : 0}% (${eWin}/${eTotal})`;

    this.e.reply(`${msg}\n\n${resultMsg}`);
    this.clearGame();
  }

  async transferCoins(winner, loser, multiplier = 1) {
    const bet = gameing[this.group_id].bet * multiplier;
    await winner.wallet.add(bet);
    await loser.wallet.deduct(bet);
    await GameDB.updateBlackjack(winner.user_id, true);
    await GameDB.updateBlackjack(loser.user_id, false);
  }

  clearGame() {
    gameing[this.group_id] = {};
    count[this.group_id] = 0;
    blackjaceState[this.group_id] = {};
    blackjackTimer[this.group_id] && clearTimeout(blackjackTimer[this.group_id]);
  }

  resetTimer() {
    blackjackTimer[this.group_id] && clearTimeout(blackjackTimer[this.group_id]);
    blackjackTimer[this.group_id] = setTimeout(() => {
      this.clearGame();
      this.e.reply("⚠️ 对战超时，游戏已结束");
    }, 1000 * 60 * 3);
  }

  initArray() {
    this.clearGame();
    cards[this.group_id] = [];
    const suits = ["♠️", "♣️", "♥️", "♦️"];
    const points = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    for (let suit of suits) {
      for (let pt of points) {
        cards[this.group_id].push([suit, pt]);
      }
    }
  }

  async getGroupId() {
    if (this.e.isGroup) {
      this.group_id = this.e.group_id;
      await redis.setEx(this.grpKey, 3600 * 24 * 30, String(this.group_id));
    } else {
      this.group_id = await redis.get(this.grpKey);
    }
    return this.group_id;
  }
}
