import plugin from '../../../lib/plugins/plugin.js';
import fs from 'fs';
import path from 'path';
import moment from 'moment';

// 设置用户数据保存路径
const dirpath = 'D:\\Yunzai\\Yunzai-Bot\\plugins\\wind-plugin\\resources\\qipai';

// 定义游戏类，继承自插件基类
export class SanGongGame extends plugin {
  // 构造函数
  constructor() {
    super({
      name: '三公游戏',
      dsc: '玩三公游戏',
      event: 'message',
      priority: -999,
      rule: [
        {
          reg: '^#?(三公|开始三公|玩三公)(\\s+\\d+)?$',
          fnc: 'startSangongGame',
        },
        {
          reg: '^#?(领低保|低保)$',
          fnc: 'claimWelfare',
        },
        {
          reg: '^#?(筹码排行榜|三公排行榜)$',
          fnc: 'chipLeaderboard',
        },
        {
          reg: '^#?(越狱)$',
          fnc: 'escapeFromPrison',
        },
        {
          reg: '^#?(余额)$',
          fnc: 'checkBalance',
        },
        {
          reg: '^#?(@.+\\s+)?转账\\s+(\\d+)$',
          fnc: 'transferChips',
        },
        {
          reg: '^#?(@.+\\s+)?打劫$',
          fnc: 'robUser',
        },
        {
          reg: '^#?(@.+\\s+)?保释$',
          fnc: 'bailOut',
        },
      ],
    });
  }

  // 初始化用户数据
  async initializeUser(userId) {
    const userData = {
      chips: 100000000, // 初始筹码
      prisonTime: null, // 用户被关进监狱的时间
    };
    fs.writeFileSync(path.join(dirpath, `${userId}_sangong.json`), JSON.stringify(userData));
  }

  // 转账功能
async transferChips(e) {
  const senderId = e.user_id;
  const receiverUsername = e.raw_message.match(/@(.+)\s+转账/)?.[1];
  const receiverId = this.getUserIdByUsername(receiverUsername);
  const amount = parseInt(e.raw_message.match(/转账\s+(\d+)/)?.[1]);

  if (!receiverUsername || isNaN(amount) || amount <= 0) {
    await e.reply('请输入有效的转账命令，如 "@用户名 转账 数额"。', { quote: e.message_id });
    return;
  }

    const senderData = await this.loadUserData(senderId);
    const receiverData = await this.loadUserData(receiverId);

    if (senderData.chips < amount) {
      await e.reply('你的筹码不足以完成转账。', { quote: e.message_id });
      return;
    }

    senderData.chips -= amount;
    receiverData.chips += amount;

    await this.saveUserData(senderId, senderData);
    await this.saveUserData(receiverId, receiverData);

    await e.reply(`成功向${receiverUsername}转账${amount}筹码。`, { quote: e.message_id });
  }
  
    // 通过用户名获取用户 ID
  getUserIdByUsername(username) {
    const userFiles = fs.readdirSync(dirpath);

    for (const userFile of userFiles) {
      if (userFile.endsWith('_sangong.json')) {
        const userId = userFile.replace('_sangong.json', '');

        // 读取用户数据，获取用户名
        const userData = JSON.parse(fs.readFileSync(path.join(dirpath, `${userId}_sangong.json`)));
        if (userData.username === username) {
          return userId;
        }
      }
    }

    return null; // 如果未找到匹配的用户，返回 null
  }

// 打劫功能
async robUser(e) {
  const robberId = e.user_id;
  const allUserFiles = fs.readdirSync(dirpath);

  // 移除自己
  const filteredUserFiles = allUserFiles.filter(userFile => !userFile.startsWith(robberId));

  // 随机选择一个用户进行打劫
  const randomIndex = Math.floor(Math.random() * filteredUserFiles.length);
  const victimId = filteredUserFiles[randomIndex].replace('_sangong.json', '');

  const victimData = await this.loadUserData(victimId);
  const robberData = await this.loadUserData(robberId);

  // 检查打劫冷却时间
  if (robberData.lastRobTime && moment().diff(moment(robberData.lastRobTime), 'minutes') < 10) {
    await e.reply('你还在打劫冷却中，请稍后再试。', { quote: e.message_id });
    return;
  }

  // 进行打劫判定
  const successRate = 0.2; // 20% 的成功率
  const success = Math.random() < successRate;

  if (success) {
    const stolenAmount = Math.ceil(victimData.chips * (Math.random() * 0.1 + 0.01)); // 随机夺取1%-10%
    victimData.chips -= stolenAmount;
    robberData.chips += stolenAmount;
    robberData.lastRobTime = moment();

    await this.saveUserData(robberId, robberData);
    await this.saveUserData(victimId, victimData);

    await e.reply(`成功打劫用户${victimId}，夺取了${stolenAmount}筹码。`, { quote: e.message_id });
  } else {
    const punishmentRate = 0.75; // 75% 的失败率
    const punishment = Math.random() < punishmentRate;

    if (punishment) {
      // 失败并关进监狱
      robberData.prisonTime = moment();
      robberData.lastRobTime = moment();
      await this.saveUserData(robberId, robberData);

      await e.reply('打劫失败，你被关进监狱，可以使用"保释"和"越狱"。', { quote: e.message_id });
    } else {
      // 被反打劫
      const stolenAmount = Math.ceil(robberData.chips * (Math.random() * 0.1 + 0.01)); // 随机夺取1%-10%
      robberData.chips -= stolenAmount;
      victimData.chips += stolenAmount;
      robberData.lastRobTime = moment();

      await this.saveUserData(robberId, robberData);
      await this.saveUserData(victimId, victimData);

      await e.reply(`打劫失败，用户${victimId}成功反打劫，夺取了你${stolenAmount}筹码。`, { quote: e.message_id });
    }
  }
}

  // 保释功能
  async bailOut(e) {
    const userId = e.user_id;
    const userData = await this.loadUserData(userId);

    // 检查是否在监狱中
    if (!userData.prisonTime || moment().diff(moment(userData.prisonTime), 'hours') >= 1) {
      await e.reply('你不在监狱中，无法保释。', { quote: e.message_id });
      return;
    }

    // 检查是否有足够的筹码进行保释
    const bailAmount = 1000000;
    if (userData.chips < bailAmount) {
      await e.reply('你的筹码不足以进行保释。', { quote: e.message_id });
      return;
    }

    // 进行保释
    userData.chips -= bailAmount;
    userData.prisonTime = null;

    await this.saveUserData(userId, userData);

    await e.reply(`成功支付${bailAmount}筹码，解除监禁。`, { quote: e.message_id });
  }
  
  // 加载用户数据
  async loadUserData(userId) {
    if (!fs.existsSync(path.join(dirpath, `${userId}_sangong.json`))) {
      await this.initializeUser(userId);
    }
    const userData = JSON.parse(fs.readFileSync(path.join(dirpath, `${userId}_sangong.json`)));
    return userData;
  }

  // 保存用户数据
  async saveUserData(userId, userData) {
    fs.writeFileSync(path.join(dirpath, `${userId}_sangong.json`), JSON.stringify(userData));
  }


  // 新增领低保功能
  async claimWelfare(e) {
    const userId = e.user_id;
    const userData = await this.loadUserData(userId);

    // 检查上次领取时间
    if (userData.lastClaimTime && moment().diff(moment(userData.lastClaimTime), 'hours') < 12) {
      await e.reply('每隔12小时才能领取一次低保哦。', { quote: e.message_id });
      return;
    }

    // 发放低保
    userData.chips += 100000000;
    userData.lastClaimTime = moment();

    // 保存用户数据
    await this.saveUserData(userId, userData);

    await e.reply('恭喜你领取了1亿筹码低保！', { quote: e.message_id });
  }

  // 开始三公游戏
  async startSangongGame(e) {
    const userId = e.user_id;
    const userData = await this.loadUserData(userId);

    // 获取用户指令中的下注金额，假设指令格式为 "开始三公 下注10000"
    const betCommand = e.raw_message.split(' ');
    let betAmount = 5000; // 默认下注金额

    // 如果用户提供了下注金额，则使用用户的金额
    if (betCommand.length > 1 && !isNaN(betCommand[1])) {
      betAmount = parseInt(betCommand[1]);
    }

    if (userData.chips < betAmount) {
      await e.reply(`你的筹码不足以下注${betAmount}筹码，无法开始三公游戏。`, { quote: e.message_id });
      return;
    }

    userData.chips -= betAmount;

    // 发牌，随机发三张牌
    const playerCards = this.drawRandomCards();
    const robotCards = this.drawRandomCards();

    const playerPoints = this.calculatePoints(playerCards);
    const robotPoints = this.calculatePoints(robotCards);

    const result = this.compareCards(playerCards, robotCards);

    let message = `你的牌：${this.cardsToString(playerCards)}，点数：${playerPoints}\n`;
message += `机器人的牌：${this.cardsToString(robotCards)}，点数：${robotPoints}\n`;

const winMultiplier = this.calculateWinMultiplier(playerPoints);
const loseMultiplier = this.calculateWinMultiplier(robotPoints);

if (result === 'player') {
  const winAmount = Math.round(betAmount * winMultiplier); // 赢了，取整
  userData.chips += winAmount;
	message += `你赢了，获得${winAmount}筹码！获得${winMultiplier}倍筹码~`;
} else if (result === 'robot') {
  const loseAmount = Math.round(betAmount * loseMultiplier); // 输了，取整
  userData.chips -= loseAmount;

  if (userData.chips < 0) {
    // Send the user to prison
    userData.prisonTime = moment();

    // Reset chips to 0
    userData.chips = 0;

    message += `庄家赢了，你失去了${loseAmount}筹码，并被关进监狱!一个小时后出狱~~~${loseMultiplier}倍筹码~`;
  } else {
    message += `庄家赢了，你失去了${loseAmount}筹码。${loseMultiplier}倍筹码~`;
  }
} else {
  userData.chips += betAmount; // 退还下注筹码
  message += '平局，下注筹码已退还。';
}

    await this.saveUserData(userId, userData);
    await e.reply(message, { quote: e.message_id });

    // 如果用户在监狱中，设置定时器，1小时后出狱
    if (userData.prisonTime) {
      setTimeout(async () => {
        await this.releaseFromPrison(userId);
      }, 3600000); // 1小时后
    }
  }

// 越狱
async escapeFromPrison(e) {
  const userId = e.user_id;
  const userData = await this.loadUserData(userId);

  // 检查是否在监狱中
  if (!userData.prisonTime || moment().diff(moment(userData.prisonTime), 'hours') >= 1) {
    await e.reply('你不在监狱中，无法越狱。', { quote: e.message_id });
    return;
  }

  // 检查上次越狱时间
  if (userData.lastEscapeTime && moment().diff(moment(userData.lastEscapeTime), 'minutes') < 1) {
    await e.reply('每隔1分钟才能尝试越狱一次。', { quote: e.message_id });
    return;
  }

  // 尝试越狱
  const escapeSuccess = Math.random() < 0.1; // 10% 的成功率
  userData.lastEscapeTime = moment();

  try {
    if (escapeSuccess) {
      await this.releaseFromPrison(userId);
      await this.saveUserData(userId, userData); // 保存用户数据
      await e.reply('恭喜你成功越狱，获得1000筹码并解除监禁！', { quote: e.message_id });
    } else {
      await this.saveUserData(userId, userData); // 保存用户数据
      await e.reply('越狱失败，你被抓了回去,请一分钟后再试。', { quote: e.message_id });
    }
  } catch (error) {
    console.error(error);
    // 处理错误
  }
}

// 出狱
async releaseFromPrison(userId) {
  const userData = await this.loadUserData(userId);

  // 赠送1000筹码
  userData.chips += 1000;
  // 解除监禁
  userData.prisonTime = null;

  await this.saveUserData(userId, userData); // 保存用户数据
}

  // 查询余额
  async checkBalance(e) {
    const userId = e.user_id;
    const userData = await this.loadUserData(userId);

    await e.reply(`你当前的余额为：${userData.chips}筹码。`, { quote: e.message_id });
  }

  // 领取筹码排行榜
  async chipLeaderboard(e) {
    const leaderboard = await this.generateChipLeaderboard();
    await e.reply(`筹码排行榜：\n${leaderboard}`);
  }

  // 生成筹码排行榜
  async generateChipLeaderboard() {
    const userFiles = fs.readdirSync(dirpath);
    const leaderboard = [];

    for (const userFile of userFiles) {
      if (userFile.endsWith('_sangong.json')) {
        const userId = userFile.replace('_sangong.json', '');
        const userData = await this.loadUserData(userId); // Await here to ensure data is loaded before proceeding
        leaderboard.push({ userId, chips: userData.chips });
      }
    }

    leaderboard.sort((a, b) => b.chips - a.chips);
    const topTen = leaderboard.slice(0, 10);

    let leaderboardString = '';
    for (let i = 0; i < topTen.length; i++) {
      leaderboardString += `${i + 1}. 用户ID: ${topTen[i].userId}, 筹码: ${topTen[i].chips}\n`;
    }

    return leaderboardString;
  }

  // 随机发牌
  drawRandomCards() {
    const deck = ['大王', '小王', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    const cards = [];

    for (let i = 0; i < 3; i++) {
      const randomIndex = Math.floor(Math.random() * deck.length);
      cards.push(deck[randomIndex]);
    }

    return cards;
  }

  // 计算牌点数
  calculatePoints(cards) {
    const pointValues = {
      '大王': 0,
      '小王': 0,
      'A': 1,
      '2': 2,
      '3': 3,
      '4': 4,
      '5': 5,
      '6': 6,
      '7': 7,
      '8': 8,
      '9': 9,
      '10': 0,
      'J': 0,
      'Q': 0,
      'K': 0,
    };

    let points = 0;
    for (const card of cards) {
      points += pointValues[card];
    }

    return points % 10;
  }

  // 比较牌的大小
  compareCards(playerCards, robotCards) {
    const playerPoints = this.calculatePoints(playerCards);
    const robotPoints = this.calculatePoints(robotCards);

    if (playerPoints > robotPoints) {
      return 'player';
    } else if (robotPoints > playerPoints) {
      return 'robot';
    } else {
      // 点数相同时，比较牌的大小
      const cardValues = ['K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2', 'A', '小王', '大王'];

      for (let i = 0; i < cardValues.length; i++) {
        const playerCardValue = playerCards.find(card => card === cardValues[i]);
        const robotCardValue = robotCards.find(card => card === cardValues[i]);

        if (playerCardValue && robotCardValue) {
          continue;
        } else if (playerCardValue) {
          return 'player';
        } else if (robotCardValue) {
          return 'robot';
        }
      }

      // 如果所有牌都相同，则是平局
      return 'tie';
    }
  }

  // 将牌转换为字符串形式
  cardsToString(cards) {
    const cardNames = {
      '大王': '大王',
      '小王': '小王',
      'A': 'A',
      '2': '2',
      '3': '3',
      '4': '4',
      '5': '5',
      '6': '6',
      '7': '7',
      '8': '8',
      '9': '9',
      '10': '10',
      'J': 'J',
      'Q': 'Q',
      'K': 'K',
    };

    return cards.map(card => cardNames[card]).join(', ');
  }

  // 计算赢得的筹码系数
  calculateWinMultiplier(points) {
    if (points === 0) return 8;
    if (points === 7) return 3;
    if (points === 8) return 4;
    if (points === 9) return 10;

    return 2; // For all other point values (e.g., 1 to 6)
  }
}