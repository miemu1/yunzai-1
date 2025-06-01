import plugin from "../../../lib/plugins/plugin.js";
import GameDB from "../model/gamedb.js";
import moment from "moment";

const robots = [
  { name: "春", id: "bot_spring" },
  { name: "夏", id: "bot_summer" },
  { name: "秋", id: "bot_autumn" },
  { name: "冬", id: "bot_winter" },
];

export class sangong extends plugin {
  constructor() {
    super({
      name: "三公游戏",
      dsc: "单人三公玩法",
      event: "message",
      priority: -999,
      rule: [
        { reg: "^#?(三公|开始三公|玩三公)(\\s+\\d+)?$", fnc: "startSangongGame" },
        { reg: "^#?(@.+\\s+)?转账\\s+(\\d+)$", fnc: "transferCoins" },
      ],
    });
  }

  async loadUserData(userId) {
    const data = await GameDB.read(userId);
    if (!data.sangong) data.sangong = {};
    const sg = data.sangong;
    if (!('prisonTime' in sg)) sg.prisonTime = null;
    if (!('lastRobTime' in sg)) sg.lastRobTime = null;
    if (!('lastClaimTime' in sg)) sg.lastClaimTime = null;
    if (!('lastEscapeTime' in sg)) sg.lastEscapeTime = null;
    await GameDB.write(userId, data);
    return data;
  }

  async saveUserData(userId, data) {
    await GameDB.write(userId, data);
  }

  async startSangongGame(e) {
    const userId = e.user_id;
    const betStr = e.raw_message.split(" ")[1];
    let betAmount = parseInt(betStr);
    if (isNaN(betAmount) || betAmount <= 0) betAmount = 5000;

    const robot = robots[Math.floor(Math.random() * robots.length)];

    const playerData = await this.loadUserData(userId);
    const robotData = await this.loadUserData(robot.id);

    if (playerData.coins < betAmount) {
      return e.reply(`金币不足，无法下注${betAmount}`);
    }

    playerData.coins -= betAmount;
    robotData.coins -= betAmount;

    const playerCards = this.drawRandomCards();
    const robotCards = this.drawRandomCards();
    const playerPoints = this.calculatePoints(playerCards);
    const robotPoints = this.calculatePoints(robotCards);
    const result = this.compareCards(playerCards, robotCards);

    const winMul = this.calculateWinMultiplier(playerPoints);
    const loseMul = this.calculateWinMultiplier(robotPoints);

    let msg = `🎲 三公对局 - 对手 ${robot.name}\n`;
    msg += `👤 你：${this.cardsToString(playerCards)} (点数 ${playerPoints})\n`;
    msg += `🤖 ${robot.name}：${this.cardsToString(robotCards)} (点数 ${robotPoints})\n`;

    if (result === "player") {
      const win = Math.round(betAmount * winMul);
      playerData.coins += betAmount + win;
      msg += `🎉 你赢了 ${win} 金币 (x${winMul})`;
      GameDB.updateSangong(userId, true);
      GameDB.updateSangong(robot.id, false);
    } else if (result === "robot") {
      const lose = Math.round(betAmount * loseMul);
      robotData.coins += betAmount + lose;
      msg += `😢 ${robot.name} 赢了你 ${lose} 金币 (x${loseMul})`;
      GameDB.updateSangong(userId, false);
      GameDB.updateSangong(robot.id, true);
      if (playerData.coins < 0) {
        playerData.sangong.prisonTime = moment();
        playerData.coins = 0;
        msg += "\n🚔 你破产被关进监狱，1小时后自动释放";
      }
    } else {
      playerData.coins += betAmount;
      robotData.coins += betAmount;
      msg += "平局，下注已返还";
      GameDB.updateSangong(userId, false);
      GameDB.updateSangong(robot.id, false);
    }

    await this.saveUserData(userId, playerData);
    await this.saveUserData(robot.id, robotData);
    await e.reply(msg);

    if (playerData.sangong.prisonTime) {
      setTimeout(async () => {
        await this.releaseFromPrison(userId);
      }, 3600000);
    }
  }

  async transferCoins(e) {
    const senderId = e.user_id;
    const receiverUsername = e.raw_message.match(/@(.+)\s+转账/)?.[1];
    const amount = parseInt(e.raw_message.match(/转账\s+(\d+)/)?.[1]);
    if (!receiverUsername || isNaN(amount) || amount <= 0) {
      return e.reply('请输入有效的转账命令，如 "@用户名 转账 数额"。');
    }
    const receiverId = await this.getUserIdByUsername(receiverUsername);
    if (!receiverId) {
      return e.reply('未找到该用户。');
    }
    const senderData = await this.loadUserData(senderId);
    const receiverData = await this.loadUserData(receiverId);
    if (senderData.coins < amount) {
      return e.reply('你的金币不足以完成转账。');
    }
    senderData.coins -= amount;
    receiverData.coins += amount;
    await this.saveUserData(senderId, senderData);
    await this.saveUserData(receiverId, receiverData);
    e.reply(`成功向${receiverUsername}转账${amount}金币。`);
  }

  async getUserIdByUsername(username) {
    const players = await GameDB.getTopCoins(1000);
    for (const p of players) {
      const data = await GameDB.read(p.user_id);
      if (data.username === username) return p.user_id;
    }
    return null;
  }

  async releaseFromPrison(userId) {
    const data = await this.loadUserData(userId);
    data.coins += 1000;
    data.sangong.prisonTime = null;
    await this.saveUserData(userId, data);
  }

  drawRandomCards() {
    const deck = ['大王', '小王', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    const cards = [];
    for (let i = 0; i < 3; i++) {
      const idx = Math.floor(Math.random() * deck.length);
      cards.push(deck[idx]);
    }
    return cards;
  }

  calculatePoints(cards) {
    const map = { '大王':0, '小王':0, 'A':1, '2':2, '3':3, '4':4, '5':5, '6':6, '7':7, '8':8, '9':9, '10':0, 'J':0, 'Q':0, 'K':0 };
    let pts = 0;
    for (const c of cards) pts += map[c];
    return pts % 10;
  }

  compareCards(playerCards, robotCards) {
    const p = this.calculatePoints(playerCards);
    const r = this.calculatePoints(robotCards);
    if (p > r) return 'player';
    if (r > p) return 'robot';
    const values = ['K','Q','J','10','9','8','7','6','5','4','3','2','A','小王','大王'];
    for (const v of values) {
      const pc = playerCards.find(c => c === v);
      const rc = robotCards.find(c => c === v);
      if (pc && rc) continue;
      if (pc) return 'player';
      if (rc) return 'robot';
    }
    return 'tie';
  }

  cardsToString(cards) {
    const names = { '大王':'大王','小王':'小王','A':'A','2':'2','3':'3','4':'4','5':'5','6':'6','7':'7','8':'8','9':'9','10':'10','J':'J','Q':'Q','K':'K' };
    return cards.map(c => names[c]).join(', ');
  }

  calculateWinMultiplier(points) {
    if (points === 0) return 8;
    if (points === 7) return 3;
    if (points === 8) return 4;
    if (points === 9) return 10;
    return 2;
  }
}
