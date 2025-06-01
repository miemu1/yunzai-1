// blackjack.js - 21点玩法强化：21点爆击、庄家通吃

import plugin from "../../../lib/plugins/plugin.js";
import { segment } from "oicq";
import GameDB from "../model/gamedb.js";

let blackjackState = {};
let gaming = {};
let joinTimer = {};
let turnTimer = {};
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

    if (gaming[this.group_id]?.state) return this.e.reply("游戏正在进行中");

    this.initArray();
    gaming[this.group_id] = {
      bet,
      state: "waiting",
      players: [
        {
          user_id: this.e.sender.user_id,
          nick: this.e.sender.card || this.e.user_id,
          wallet: w,
          robot: false,
          busted: false,
          stopped: false,
        },
      ],
      current: 0,
    };

    blackjackState[this.group_id] = {};

    this.e.reply(
      `🎮 ${this.e.sender.card || this.e.user_id} 发起了 21点 对局！\n` +
        `💰 下注金额：${bet} 金币\n` +
        `👉 10秒内发送“叫牌”即可加入游戏（最多4人）`
    );

    joinTimer[this.group_id] = setTimeout(() => this.beginGame(), 10000);

    blackjackTimer[this.group_id] && clearTimeout(blackjackTimer[this.group_id]);
    blackjackTimer[this.group_id] = setTimeout(() => {
      this.clearGame();
      this.e.reply("⚠️ 对战超时，游戏已结束");
    }, 1000 * 60 * 3);
  }

  async beginGame() {
    const g = gaming[this.group_id];
    if (!g || g.state !== "waiting") return;

    clearTimeout(joinTimer[this.group_id]);

    const Wallet = (await import("../model/wallet.js")).default;
    const robot = robots[Math.floor(Math.random() * robots.length)];
    const robotWallet = new Wallet({ user_id: robot.id });
    await GameDB.getCoins(robot.id);
    g.players.push({
      user_id: robot.id,
      nick: robot.name,
      wallet: robotWallet,
      robot: true,
      busted: false,
      stopped: false,
    });

    g.state = "playing";
    blackjackState[this.group_id] = {};

    for (const p of g.players) {
      blackjackState[this.group_id][p.user_id] = [];
      this.drawCard(p.user_id);
      this.drawCard(p.user_id);
      if (this.getPoint(blackjackState[this.group_id][p.user_id]) > 21) {
        p.busted = true;
      }
    }

    this.nextTurn();
  }

  drawCard(userId) {
    const deck = cards[this.group_id];
    const index = Math.floor(Math.random() * deck.length);
    const card = deck.splice(index, 1)[0];
    blackjackState[this.group_id][userId].push(card);
  }

  nextTurn() {
    const g = gaming[this.group_id];
    if (!g || g.state !== "playing") return;

    const alive = g.players.some(p => !p.stopped && !p.busted);
    if (!alive) {
      this.finishGame();
      return;
    }

    g.current = g.current % g.players.length;
    const player = g.players[g.current];
    if (player.stopped || player.busted) {
      g.current++;
      this.nextTurn();
      return;
    }

    if (player.robot) {
      while (this.getPoint(blackjackState[this.group_id][player.user_id]) < 17) {
        this.drawCard(player.user_id);
      }
      if (this.getPoint(blackjackState[this.group_id][player.user_id]) > 21) {
        player.busted = true;
      } else {
        player.stopped = true;
      }
      g.current++;
      this.nextTurn();
      return;
    }

    this.e.reply([
      segment.at(player.user_id, player.nick),
      ` 请发送“叫牌”或“停牌” (10秒后默认停牌)\n` + this.formatGameState(),
    ]);

    clearTimeout(turnTimer[this.group_id]);
    turnTimer[this.group_id] = setTimeout(() => {
      player.stopped = true;
      g.current++;
      this.nextTurn();
    }, 10000);
  }

  async finishGame() {
    const g = gaming[this.group_id];
    if (!g) return;
    clearTimeout(turnTimer[this.group_id]);

    const dealer = g.players[0];
    const bet = g.bet;
    const results = [];
    const changes = {};
    g.players.forEach(p => changes[p.user_id] = 0);

    const dealerPoint = this.getPoint(
      blackjackState[this.group_id][dealer.user_id]
    );
    const allBusted = g.players.every((p) => p.busted);
    const isDealerBlackjack = dealerPoint === 21 && !dealer.busted;

    if (allBusted) {
      for (const p of g.players) {
        await p.wallet.deduct(bet);
        await GameDB.updateBlackjack(p.user_id, false);
        changes[p.user_id] -= bet;
        results.push(`💥 ${p.nick} 爆掉，损失 ${bet} 金币`);
      }
      results.push("🏴‍☠️ 全员爆牌，无人获胜");
    } else {
      for (let i = 1; i < g.players.length; i++) {
        const p = g.players[i];
        const point = this.getPoint(blackjackState[this.group_id][p.user_id]);
        const isPlayerBJ = point === 21 && !p.busted;

        if (isDealerBlackjack && isPlayerBJ) {
          await this.transferCoins(dealer, p, 1);
          changes[dealer.user_id] += bet;
          changes[p.user_id] -= bet;
          results.push(`🏆 ${dealer.nick} 与 ${p.nick} 均为21点，庄家通吃，${p.nick} 损失 ${bet} 金币`);
          continue;
        }

        if (p.busted) {
          await this.transferCoins(dealer, p, 1);
          changes[dealer.user_id] += bet;
          changes[p.user_id] -= bet;
          results.push(`💥 ${p.nick} 爆掉，${dealer.nick} 获胜，损失 ${bet} 金币`);
          continue;
        }

        if (isPlayerBJ) {
          await this.transferCoins(p, dealer, 5);
          changes[p.user_id] += bet * 5;
          changes[dealer.user_id] -= bet * 5;
          results.push(`🎉 ${p.nick} 爆击21点，赢得5倍奖励 ${bet * 5} 金币`);
        } else if (dealerPoint > 21 || point > dealerPoint) {
          await this.transferCoins(p, dealer, 1);
          changes[p.user_id] += bet;
          changes[dealer.user_id] -= bet;
          results.push(`🎉 ${p.nick} 战胜庄家，获得 ${bet} 金币`);
        } else if (point === dealerPoint) {
          await dealer.wallet.add(bet);
          await p.wallet.add(bet);
          await GameDB.updateBlackjack(dealer.user_id, false);
          await GameDB.updateBlackjack(p.user_id, false);
          results.push(`⚖️ ${p.nick} 与庄家平局`);
        } else {
          await this.transferCoins(dealer, p, 1);
          changes[dealer.user_id] += bet;
          changes[p.user_id] -= bet;
          results.push(`😢 ${p.nick} 输给庄家，损失 ${bet} 金币`);
        }
      }
    }

    const statusList = await Promise.all(
      g.players.map(async p => {
        const bal = await p.wallet.getBalance();
        const stats = await GameDB.getStats?.(p.user_id, "blackjack");
        const win = stats?.win || 0;
        const total = stats?.total || 0;
        return `📌 ${p.robot ? "🤖" : "👤"} ${p.nick}｜余额：${bal}｜胜率：${total ? ((win / total) * 100).toFixed(1) : 0}% (${win}/${total})`;
      })
    );

    const changeLines = g.players.map(p => {
      const c = changes[p.user_id];
      if (!c) return `📊 ${p.nick} 本局未获金币`;
      return `📊 ${p.nick} ${c > 0 ? "赢得" : "输掉"} ${Math.abs(c)} 金币`;
    });

    let msg = this.formatGameState();
    msg += `\n${statusList.join("\n")}`;
    msg += `\n${changeLines.join("\n")}`;
    msg += `\n${results.join("\n")}`;

    await this.e.reply(msg);
    this.clearGame();
  }

  async deal() {
    await this.getGroupId();
    const g = gaming[this.group_id];
    if (!g || !g.state) return this.e.reply("没有进行中的21点游戏");

    const userId = this.e.sender.user_id;

    if (g.state === "waiting") {
      if (g.players.find(p => p.user_id === userId)) return this.e.reply("已加入游戏");
      if (g.players.length >= 4) return this.e.reply("人数已满");

      const Wallet = (await import("../model/wallet.js")).default;
      const w = new Wallet(this.e);
      const bal = await w.getBalance();
      if (bal < g.bet) return this.e.reply("金币不足，无法加入");

      g.players.push({ user_id, nick: this.e.sender.card || userId, wallet: w, robot: false, busted: false, stopped: false });
      this.e.reply(`${this.e.sender.card || userId} 加入了游戏`);
      if (g.players.length >= 4) this.beginGame();
      return;
    }

    const player = g.players[g.current];
    if (!player || player.user_id !== userId) return;

    clearTimeout(turnTimer[this.group_id]);
    this.drawCard(userId);
    const playerPoint = this.getPoint(blackjackState[this.group_id][userId]);

    if (playerPoint > 21) {
      player.busted = true;
      await this.e.reply(this.formatGameState() + `\n💥 ${player.nick} 爆掉`);
      g.current++;
      this.nextTurn();
      return;
    }

    this.nextTurn();
  }

  async stop() {
    await this.getGroupId();
    const g = gaming[this.group_id];
    if (!g || g.state !== "playing") return this.e.reply("没有进行中的21点游戏");

    const player = g.players[g.current];
    if (player.user_id !== this.e.user_id) return;

    clearTimeout(turnTimer[this.group_id]);
    player.stopped = true;
    g.current++;
    this.nextTurn();
  }

  formatGameState() {
    const state = blackjackState[this.group_id];
    const g = gaming[this.group_id];
    if (!g) return "";

    let msg = "📋 当前牌局：\n";
    g.players.forEach((p, idx) => {
      const role = p.robot ? "🤖" : idx === 0 ? "庄" : "👤";
      msg += `${role} ${p.nick}：` + this.cardList(state[p.user_id]) + ` = ${this.getPoint(state[p.user_id])} 点\n`;
    });
    return msg.trim();
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

  async transferCoins(winner, loser, multiplier = 1) {
    const bet = gaming[this.group_id].bet * multiplier;
    await winner.wallet.add(bet);
    await loser.wallet.deduct(bet);
    await GameDB.updateBlackjack(winner.user_id, true);
    await GameDB.updateBlackjack(loser.user_id, false);
  }

  clearGame() {
    delete gaming[this.group_id];
    delete blackjackState[this.group_id];
    blackjackTimer[this.group_id] && clearTimeout(blackjackTimer[this.group_id]);
    clearTimeout(joinTimer[this.group_id]);
    clearTimeout(turnTimer[this.group_id]);
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
    for (let deck = 0; deck < 4; deck++) {
      for (let suit of suits) {
        for (let pt of points) {
          cards[this.group_id].push([suit, pt]);
        }
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
