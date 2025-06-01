import plugin from "../../../lib/plugins/plugin.js";
import Wallet from "../model/wallet.js";

const robots = [
  { name: "春", id: "bot_spring" },
  { name: "夏", id: "bot_summer" },
  { name: "秋", id: "bot_autumn" },
  { name: "冬", id: "bot_winter" },
];

const robotCoins = {};
const robotBankrupt = {};
const statsMap = {}; // 长期胜率记录
robots.forEach((r) => {
  robotCoins[r.id] = 1000000;
  robotBankrupt[r.id] = 0;
  statsMap[r.id] = { wins: 0, total: 0 };
});

const games = {};
const banker = {}; // group -> userId

export class douniu extends plugin {
  constructor() {
    super({
      name: "斗牛",
      dsc: "斗牛小游戏",
      event: "message.group",
      priority: 500,
      rule: [
        {
          reg: "^斗牛(\\s*\\d+)?$",
          fnc: "join",
        },
      ],
    });
  }

  async join() {
    const betStr = this.e.msg.replace("斗牛", "").trim();
    let bet = parseInt(betStr);
    if (isNaN(bet)) bet = 1000;
    if (bet < 10) bet = 10;

    const w = new Wallet(this.e);
    const bal = await w.getBalance();
    if (bal < bet) {
      this.e.reply("💰 金币不足，无法下注。");
      return;
    }

    const gid = this.e.group_id;
    if (!games[gid]) {
      games[gid] = { players: [], timer: null, started: false };
    }
    const game = games[gid];

    if (game.started) {
      this.e.reply("⏳ 本局已开始，请等待下一局。");
      return;
    }

    if (game.players.find((p) => p.user_id === this.e.user_id)) {
      this.e.reply("📌 已加入游戏，玩家在10秒内发送例如"斗牛 1000"即可加入本局游戏,10秒后自动开始。");
      return;
    }

    game.players.push({
      user_id: this.e.user_id,
      nick: this.e.sender.card || this.e.nickname || this.e.user_id,
      bet,
      wallet: w,
    });

    this.e.reply(`✅ ${this.e.sender.card || this.e.user_id} 已加入斗牛，下注 ${bet} 金币`);

    if (game.players.length === 1) {
      game.timer && clearTimeout(game.timer);
      game.timer = setTimeout(() => this.startGame(gid), 10000);
    }

    if (game.players.length === 5) {
      clearTimeout(game.timer);
      this.startGame(gid);
    }
  }

  async startGame(gid) {
    const game = games[gid];
    if (!game || game.started) return;
    game.started = true;

    const userBet = game.players[0].bet;

    let robotIdx = 0;
    while (game.players.length < 5) {
      const robot = robots[robotIdx % robots.length];
      let available = robotCoins[robot.id];
      let bet = available >= userBet ? userBet : available;
      if (available < userBet) {
        robotBankrupt[robot.id]++;
        robotCoins[robot.id] = 1000000;
        bet = robotCoins[robot.id] >= userBet ? userBet : robotCoins[robot.id];
      }
      const suffix = robotBankrupt[robot.id] > 0 ? `(${robotBankrupt[robot.id]}次破产)` : "";
      game.players.push({
        user_id: robot.id,
        nick: robot.name + suffix,
        bet,
        robot: true,
      });
      robotIdx++;
    }

    const deck = createDeck();
    shuffle(deck);

    game.players.forEach((p) => {
      p.cards = deck.splice(0, 5);
      p.result = calcCow(p.cards);
    });

    const bankerId = banker[gid] || game.players[Math.floor(Math.random() * game.players.length)].user_id;
    banker[gid] = bankerId;
    const bankerPlayer = game.players.find((p) => p.user_id === bankerId);
    bankerPlayer.isBanker = true;

    const msgs = [];
    msgs.push(`🎲 本局庄家：${bankerPlayer.nick} 🎲\n`);

    for (const p of game.players) {
      const tag = p.isBanker ? "👑[庄]" : "👤[闲]";
      const cardStr = p.cards.join(" ");
      msgs.push(`【${tag}】${p.nick}\n🎴 手牌：${cardStr}\n📢 结果：${p.result.text}\n`);
    }

    msgs.push("\n📊 结算：");
    for (const p of game.players) {
      if (p.user_id === bankerId) continue;
      const cmp = compare(p.result, bankerPlayer.result);
      let multi = Math.max(p.result.multiplier, bankerPlayer.result.multiplier);
      const amount = multi * p.bet;
      let resultMsg = "";
      let emoji = "";

      if (cmp > 0) {
        await changeCoins(p, amount);
        await changeCoins(bankerPlayer, -amount);
        emoji = "😄";
        resultMsg = `${emoji} ${p.nick} 赢了庄家 ${amount} 金币 💰 (赔率 x${multi})`;
        updateStats(p.user_id, true);
        updateStats(bankerPlayer.user_id, false);
      } else if (cmp < 0) {
        await changeCoins(p, -amount);
        await changeCoins(bankerPlayer, amount);
        emoji = "😢";
        resultMsg = `${emoji} ${p.nick} 输给庄家 ${amount} 金币 💸 (赔率 x${multi})`;
        updateStats(p.user_id, false);
        updateStats(bankerPlayer.user_id, true);
      } else {
        emoji = "😐";
        resultMsg = `${emoji} ${p.nick} 与庄家平局，无输赢`;
        updateStats(p.user_id, false);
        updateStats(bankerPlayer.user_id, false);
      }
      msgs.push(resultMsg);
    }

    msgs.push("\n💼 玩家金币余额：");
    for (const p of game.players) {
      let balance = 0;
      if (p.robot) {
        balance = robotCoins[p.user_id];
      } else {
        balance = await p.wallet.getBalance();
      }
      msgs.push(`🧍 ${p.nick}：${balance} 金币`);
    }

    msgs.push("\n📈 玩家长期胜率统计：");
    for (const p of game.players) {
      const s = statsMap[p.user_id] || { wins: 0, total: 0 };
      const winRate = s.total > 0 ? ((s.wins / s.total) * 100).toFixed(1) : "0.0";
      msgs.push(`📊 ${p.nick}：${s.wins}/${s.total} 胜 (${winRate}%)`);
    }

    const resMsgs = msgs.join("\n");
    this.e.reply(resMsgs);

    game.players = [];
    game.started = false;
  }
}

function updateStats(uid, win) {
  if (!statsMap[uid]) statsMap[uid] = { wins: 0, total: 0 };
  statsMap[uid].total++;
  if (win) statsMap[uid].wins++;
}

function createDeck() {
  const points = ["A", 2, 3, 4, 5, 6, 7, 8, 9, 10, "J", "Q", "K"];
  const suits = ["♠", "♥", "♣", "♦"];
  const deck = [];
  suits.forEach((s) => {
    points.forEach((p) => deck.push(`${s}${p}`));
  });
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function cardValue(card) {
  const p = card.slice(1);
  if (["J", "Q", "K"].includes(p)) return 10;
  if (p === "A") return 1;
  return parseInt(p);
}

function calcCow(cards) {
  const values = cards.map(cardValue);
  const sum = values.reduce((a, b) => a + b, 0);
  const counts = {};
  values.forEach((v) => (counts[v] = (counts[v] || 0) + 1));

  if (Object.values(counts).includes(4)) return { text: "炸弹", rank: 7, multiplier: 5 };
  if (values.every((v) => v <= 5) && sum <= 10) return { text: "五小牛", rank: 6, multiplier: 5 };
  if (cards.every((c) => ["J", "Q", "K"].includes(c.slice(1)))) return { text: "五花牛", rank: 5, multiplier: 5 };
  if (values.filter((v) => v === 10).length === 1 && cards.filter((c) => ["J", "Q", "K"].includes(c.slice(1))).length === 4)
    return { text: "四花牛", rank: 4, multiplier: 4 };

  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 4; j++) {
      for (let k = j + 1; k < 5; k++) {
        if ((values[i] + values[j] + values[k]) % 10 === 0) {
          const rest = sum - values[i] - values[j] - values[k];
          const cow = rest % 10;
          if (cow === 0) return { text: "斗牛", rank: 3, multiplier: 3 };
          if (cow >= 7) return { text: `牛${cow}`, rank: 2 + cow / 10, multiplier: 2 };
          if (cow > 0) return { text: `牛${cow}`, rank: 1, multiplier: 1 };
        }
      }
    }
  }
  return { text: "无牛", rank: 0, multiplier: 1 };
}

function compare(a, b) {
  if (a.rank > b.rank) return 1;
  if (a.rank < b.rank) return -1;
  return 0;
}

async function changeCoins(player, amount) {
  if (player.robot) {
    robotCoins[player.user_id] += amount;
    if (robotCoins[player.user_id] <= 0) {
      robotBankrupt[player.user_id]++;
      robotCoins[player.user_id] = 1000000;
    }
  } else {
    if (!player.wallet) player.wallet = new Wallet({ user_id: player.user_id });
    if (amount > 0) await player.wallet.add(amount);
    else await player.wallet.deduct(-amount);
  }
}
