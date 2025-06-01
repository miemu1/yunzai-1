import plugin from "../../../lib/plugins/plugin.js";
import GameDB from "../model/gamedb.js";
import moment from "moment";

export class sangong extends plugin {
  constructor() {
    super({
      name: "三公游戏",
      dsc: "单人三公玩法",
      event: "message",
      priority: -999,
      rule: [
        { reg: "^#?(三公|开始三公|玩三公)(\\s+\\d+)?$", fnc: "startSangongGame" },
        { reg: "^#?(领低保|低保)$", fnc: "claimWelfare" },
        { reg: "^#?(金币排行榜|筹码排行榜|三公排行榜)$", fnc: "coinLeaderboard" },
        { reg: "^#?(越狱)$", fnc: "escapeFromPrison" },
        { reg: "^#?(余额)$", fnc: "checkBalance" },
        { reg: "^#?(@.+\\s+)?转账\\s+(\\d+)$", fnc: "transferCoins" },
        { reg: "^#?(@.+\\s+)?打劫$", fnc: "robUser" },
        { reg: "^#?(@.+\\s+)?保释$", fnc: "bailOut" },
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

  async claimWelfare(e) {
    const data = await this.loadUserData(e.user_id);
    const sg = data.sangong;
    if (sg.lastClaimTime && moment().diff(moment(sg.lastClaimTime), "hours") < 12) {
      return e.reply("每隔12小时才能领取一次低保哦。");
    }
    data.coins += 100000000;
    sg.lastClaimTime = moment();
    await this.saveUserData(e.user_id, data);
    e.reply("恭喜你领取了1亿金币低保！");
  }

  async startSangongGame(e) {
    const userId = e.user_id;
    const betCommand = e.raw_message.split(" ");
    let betAmount = 5000;
    if (betCommand.length > 1 && !isNaN(betCommand[1])) {
      betAmount = parseInt(betCommand[1]);
    }
    const data = await this.loadUserData(userId);
    if (data.coins < betAmount) {
      return e.reply(`你的金币不足以下注${betAmount}金币，无法开始三公游戏。`);
    }
    data.coins -= betAmount;

    const playerCards = this.drawRandomCards();
    const robotCards = this.drawRandomCards();

    const playerPoints = this.calculatePoints(playerCards);
    const robotPoints = this.calculatePoints(robotCards);

    const result = this.compareCards(playerCards, robotCards);

    let msg = `你的牌：${this.cardsToString(playerCards)}，点数：${playerPoints}\n`;
    msg += `机器人的牌：${this.cardsToString(robotCards)}，点数：${robotPoints}\n`;

    const winMultiplier = this.calculateWinMultiplier(playerPoints);
    const loseMultiplier = this.calculateWinMultiplier(robotPoints);

    if (result === "player") {
      const winAmount = Math.round(betAmount * winMultiplier);
      data.coins += winAmount;
      msg += `你赢了，获得${winAmount}金币！获得${winMultiplier}倍奖励~`;
    } else if (result === "robot") {
      const loseAmount = Math.round(betAmount * loseMultiplier);
      data.coins -= loseAmount;
      if (data.coins < 0) {
        data.sangong.prisonTime = moment();
        data.coins = 0;
        msg += `庄家赢了，你失去了${loseAmount}金币，并被关进监狱!一个小时后出狱~~~${loseMultiplier}倍金币~`;
      } else {
        msg += `庄家赢了，你失去了${loseAmount}金币。${loseMultiplier}倍金币~`;
      }
    } else {
      data.coins += betAmount;
      msg += "平局，下注金币已退还。";
    }

    await this.saveUserData(userId, data);
    e.reply(msg);

    if (data.sangong.prisonTime) {
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

  async robUser(e) {
    const robberId = e.user_id;
    const players = await GameDB.getTopCoins(1000);
    const targets = players.filter((p) => p.user_id !== robberId);
    if (targets.length === 0) return e.reply('暂无可打劫的对象。');
    const victimId = targets[Math.floor(Math.random() * targets.length)].user_id;

    const victimData = await this.loadUserData(victimId);
    const robberData = await this.loadUserData(robberId);

    if (
      robberData.sangong.lastRobTime &&
      moment().diff(moment(robberData.sangong.lastRobTime), 'minutes') < 10
    ) {
      return e.reply('你还在打劫冷却中，请稍后再试。');
    }

    const success = Math.random() < 0.2;
    if (success) {
      const stolen = Math.ceil(victimData.coins * (Math.random() * 0.1 + 0.01));
      victimData.coins -= stolen;
      robberData.coins += stolen;
      robberData.sangong.lastRobTime = moment();
      await this.saveUserData(robberId, robberData);
      await this.saveUserData(victimId, victimData);
      e.reply(`成功打劫用户${victimId}，夺取了${stolen}金币。`);
    } else {
      const punishment = Math.random() < 0.75;
      if (punishment) {
        robberData.sangong.prisonTime = moment();
        robberData.sangong.lastRobTime = moment();
        await this.saveUserData(robberId, robberData);
        e.reply('打劫失败，你被关进监狱，可以使用"保释"和"越狱"。');
      } else {
        const stolen = Math.ceil(robberData.coins * (Math.random() * 0.1 + 0.01));
        robberData.coins -= stolen;
        victimData.coins += stolen;
        robberData.sangong.lastRobTime = moment();
        await this.saveUserData(robberId, robberData);
        await this.saveUserData(victimId, victimData);
        e.reply(`打劫失败，用户${victimId}成功反打劫，夺取了你${stolen}金币。`);
      }
    }
  }

  async bailOut(e) {
    const userId = e.user_id;
    const data = await this.loadUserData(userId);
    if (!data.sangong.prisonTime || moment().diff(moment(data.sangong.prisonTime), 'hours') >= 1) {
      return e.reply('你不在监狱中，无法保释。');
    }
    const bailAmount = 1000000;
    if (data.coins < bailAmount) {
      return e.reply('你的金币不足以进行保释。');
    }
    data.coins -= bailAmount;
    data.sangong.prisonTime = null;
    await this.saveUserData(userId, data);
    e.reply(`成功支付${bailAmount}金币，解除监禁。`);
  }

  async escapeFromPrison(e) {
    const userId = e.user_id;
    const data = await this.loadUserData(userId);
    if (!data.sangong.prisonTime || moment().diff(moment(data.sangong.prisonTime), 'hours') >= 1) {
      return e.reply('你不在监狱中，无法越狱。');
    }
    if (data.sangong.lastEscapeTime && moment().diff(moment(data.sangong.lastEscapeTime), 'minutes') < 1) {
      return e.reply('每隔1分钟才能尝试越狱一次。');
    }
    const success = Math.random() < 0.1;
    data.sangong.lastEscapeTime = moment();
    if (success) {
      await this.releaseFromPrison(userId);
      await this.saveUserData(userId, data);
      e.reply('恭喜你成功越狱，获得1000金币并解除监禁！');
    } else {
      await this.saveUserData(userId, data);
      e.reply('越狱失败，你被抓了回去,请一分钟后再试。');
    }
  }

  async releaseFromPrison(userId) {
    const data = await this.loadUserData(userId);
    data.coins += 1000;
    data.sangong.prisonTime = null;
    await this.saveUserData(userId, data);
  }

  async checkBalance(e) {
    const data = await this.loadUserData(e.user_id);
    e.reply(`你当前的余额为：${data.coins}金币。`);
  }

  async coinLeaderboard(e) {
    const leaderboard = await this.generateCoinLeaderboard();
    e.reply(`金币排行榜：\n${leaderboard}`);
  }

  async generateCoinLeaderboard() {
    const top = await GameDB.getTopCoins(10);
    let str = '';
    for (let i = 0; i < top.length; i++) {
      str += `${i + 1}. 用户ID: ${top[i].user_id}, 金币: ${top[i].coins}\n`;
    }
    return str;
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
