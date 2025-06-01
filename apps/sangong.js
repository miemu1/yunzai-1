import plugin from "../../../lib/plugins/plugin.js";
import Wallet from "../model/wallet.js";
import GameDB from "../model/gamedb.js";

const robots = [
  { name: "春", id: "bot_spring" },
  { name: "夏", id: "bot_summer" },
  { name: "秋", id: "bot_autumn" },
  { name: "冬", id: "bot_winter" },
];

const robotCoins = {};
const robotBankrupt = {};
const statsMap = {};
robots.forEach((r) => {
  robotCoins[r.id] = 1000000;
  robotBankrupt[r.id] = 0;
  statsMap[r.id] = { wins: 0, total: 0 };
  GameDB.getCoins(r.id);
});

const games = {};

export class sangong extends plugin {
  constructor() {
    super({
      name: "三公",
      dsc: "三公小游戏",
      event: "message.group",
      priority: 500,
      rule: [
        { reg: "^#*\/?三公(\s*\d+)?$", fnc: "join" },
        { reg: "^加入(三公)?$", fnc: "join" },
        { reg: "^三公战绩$", fnc: "record" },
      ],
    });
  }

  async join() {
    const gid = this.e.group_id;
    const raw = this.e.msg.trim();
    if (!gid) return;

    if (/^#*\/?三公/.test(raw)) {
      const betStr = raw.replace(/^#*\/?三公/, "").trim();
      let bet = parseInt(betStr);
      if (isNaN(bet) || bet <= 0) bet = 100;
      GameDB.getCoins(this.e.user_id);
      const w = new Wallet(this.e);
      const bal = await w.getBalance();
      if (bal < bet) return this.e.reply("金币不足，无法下注");

      if (!games[gid] || games[gid].started) {
        games[gid] = { players: [], bet, started: false, timer: null };
      }
      const game = games[gid];
      if (game.started) return this.e.reply("游戏已经开始");

      if (!game.players.find((p) => p.user_id === this.e.user_id)) {
        game.players.push({
          user_id: this.e.user_id,
          nick: this.e.sender.card || this.e.nickname || this.e.user_id,
          wallet: w,
          robot: false,
          bet: game.bet
        });
      }
      this.e.reply(`@${this.e.sender.card || this.e.user_id} 发起了三公游戏，下注 ${bet} 金币！10秒内输入“加入三公”可参与！（最多5人）`);
      clearTimeout(game.timer);
      game.timer = setTimeout(() => startGame(gid, this.e), 10000);
    } else if (/^加入(三公)?$/.test(raw)) {
      const game = games[gid];
      if (!game || game.started) return this.e.reply("暂无等待中的三公游戏");
      if (game.players.find((p) => p.user_id === this.e.user_id)) return this.e.reply("已加入游戏，等待开始");
      const w = new Wallet(this.e);
      const bal = await w.getBalance();
      if (bal < game.bet) return this.e.reply("金币不足，无法加入");
      game.players.push({
        user_id: this.e.user_id,
        nick: this.e.sender.card || this.e.nickname || this.e.user_id,
        wallet: w,
        robot: false,
        bet: game.bet
      });
      this.e.reply(`${this.e.sender.card || this.e.user_id} 加入游戏！`);
      if (game.players.length >= 5) {
        clearTimeout(game.timer);
        startGame(gid, this.e);
      }
    } 
  }

  async record() {
    GameDB.getCoins(this.e.user_id);
    const w = new Wallet(this.e);
    const bal = await w.getBalance();
    const stats = await GameDB.getStats?.(this.e.user_id, "sangong");
    const win = stats?.win || 0;
    const total = stats?.total || 0;
    const rate = total > 0 ? ((win / total) * 100).toFixed(1) : "0.0";
    const nick = this.e.sender.card || this.e.nickname || this.e.user_id;
    this.e.reply(
      `🎴 三公战绩\n` +
        `玩家：${nick}\n` +
        `对局数：${total}\n` +
        `胜率：${rate}% (${win}/${total})\n` +
        `当前余额：${bal} 金币`
    );
  }
}

async function startGame(gid, e) {
  const game = games[gid];
  if (!game || game.started) return;
  game.started = true;

  if (game.players.length < 2) {
    const robot = robots[Math.floor(Math.random() * robots.length)];
    let bet = Math.min(game.bet, robotCoins[robot.id]);
    if (robotCoins[robot.id] < game.bet) {
      robotBankrupt[robot.id]++;
      robotCoins[robot.id] = 1000000;
      bet = Math.min(game.bet, robotCoins[robot.id]);
    }
    const suffix = robotBankrupt[robot.id] > 0 ? `(${robotBankrupt[robot.id]}次破产)` : "";
    game.players.push({
      user_id: robot.id,
      nick: robot.name + suffix,
      robot: true,
      bet,
    });
  }

  const deck = createDeck();
  shuffle(deck);
  game.players.forEach((p) => {
    p.cards = deck.splice(0, 3);
    p.hand = calcHand(p.cards);
  });

  const msgs = [];
  msgs.push("🎴 发牌：");
  game.players.forEach((p) => {
    msgs.push(`${p.nick}：${p.cards.join(" ")} → ${p.hand.name}${p.hand.score !== undefined ? p.hand.score : ""}`);
  });
  msgs.push("\n📊 结算中...");

  const changes = {};
  game.players.forEach((p) => (changes[p.user_id] = 0));

  for (let i = 0; i < game.players.length; i++) {
    for (let j = i + 1; j < game.players.length; j++) {
      const a = game.players[i];
      const b = game.players[j];
      const cmp = compareHands(a.hand, b.hand);
      if (cmp > 0) {
        const winAmt = a.hand.coef * b.bet;
        changes[a.user_id] += winAmt;
        changes[b.user_id] -= winAmt;
        updateStats(a.user_id, true);
        updateStats(b.user_id, false);
      } else if (cmp < 0) {
        const winAmt = b.hand.coef * a.bet;
        changes[b.user_id] += winAmt;
        changes[a.user_id] -= winAmt;
        updateStats(b.user_id, true);
        updateStats(a.user_id, false);
      } else {
        updateStats(a.user_id, false);
        updateStats(b.user_id, false);
      }
    }
  }

  msgs.push("\n结果：");
  for (const p of game.players) {
    const change = changes[p.user_id];
    if (change > 0) msgs.push(`+${change} 金币 → ${p.nick}`);
    else if (change < 0) msgs.push(`${change} 金币 → ${p.nick}`);
    else msgs.push(`0 金币 → ${p.nick}`);
    if (p.robot) {
      robotCoins[p.user_id] += change;
      if (robotCoins[p.user_id] <= 0) {
        robotBankrupt[p.user_id]++;
        robotCoins[p.user_id] = 1000000;
      }
      GameDB.addCoins(p.user_id, change);
    } else {
      if (!p.wallet) p.wallet = new Wallet({ user_id: p.user_id });
      if (change > 0) p.wallet.add(change);
      else if (change < 0) p.wallet.deduct(-change);
    }
  }

  msgs.push("\n💼 玩家金币余额：");
  for (const p of game.players) {
    let balance = 0;
    if (p.robot) {
      balance = robotCoins[p.user_id];
    } else {
      if (!p.wallet) p.wallet = new Wallet({ user_id: p.user_id });
      balance = await p.wallet.getBalance();
    }
    msgs.push(`🧍 ${p.nick}：${balance} 金币`);
  }

  msgs.push("\n📈 玩家长期胜率统计：");
  for (const p of game.players) {
    const s = statsMap[p.user_id] || { wins: 0, total: 0 };
    const rate = s.total > 0 ? ((s.wins / s.total) * 100).toFixed(1) : "0.0";
    msgs.push(`📊 ${p.nick}：${s.wins}/${s.total} 胜 (${rate}%)`);
  }

  e.reply(msgs.join("\n"));
  game.started = false;
  game.players = [];
}

function updateStats(uid, win) {
  if (!statsMap[uid]) statsMap[uid] = { wins: 0, total: 0 };
  statsMap[uid].total++;
  if (win) statsMap[uid].wins++;
  GameDB.updateSangong(uid, win);
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

function valueOf(card) {
  const v = card.slice(1);
  if (v === "A") return 1;
  if (v === "J") return 11;
  if (v === "Q") return 12;
  if (v === "K") return 13;
  return parseInt(v);
}

function suitOf(card) {
  return card[0];
}

function calcHand(cards) {
  const values = cards.map(valueOf);
  const suits = cards.map(suitOf);
  const gongCount = values.filter((v) => v >= 11).length;

  if (gongCount === 3 && new Set(values).size === 1) {
    return { name: "大三公", type: 5, coef: 9, major: values[0], suit: highestSuit(cards) };
  }
  if (gongCount === 0 && new Set(values).size === 1) {
    return { name: "小三公", type: 4, coef: 7, major: values[0], suit: highestSuit(cards) };
  }
  if (gongCount === 3) {
    return { name: "混三公", type: 3, coef: 5, major: Math.max(...values), suit: highestSuit(cards) };
  }
  const point = values.filter((v) => v <= 10).reduce((a, b) => a + b, 0) % 10;
  if (point === 8 || point === 9) {
    return { name: "特点数", type: 2, coef: 3, score: point, gong: gongCount, major: Math.max(...values), suit: highestSuit(cards) };
  }
  return { name: "单牌", type: 1, coef: 1, score: point, gong: gongCount, major: Math.max(...values), suit: highestSuit(cards) };
}

function highestSuit(cards) {
  const order = { "♠": 4, "♥": 3, "♣": 2, "♦": 1 };
  let max = cards[0];
  cards.forEach((c) => {
    if (valueOf(c) > valueOf(max)) max = c;
    else if (valueOf(c) === valueOf(max) && order[suitOf(c)] > order[suitOf(max)]) max = c;
  });
  return suitOf(max);
}

function compareHands(a, b) {
  if (a.type > b.type) return 1;
  if (a.type < b.type) return -1;
  if (a.type === 5 || a.type === 4) {
    if (a.major > b.major) return 1;
    if (a.major < b.major) return -1;
    return 0;
  }
  if (a.type === 3) {
    if (a.major > b.major) return 1;
    if (a.major < b.major) return -1;
    const order = { "♠": 4, "♥": 3, "♣": 2, "♦": 1 };
    if (order[a.suit] > order[b.suit]) return 1;
    if (order[a.suit] < order[b.suit]) return -1;
    return 0;
  }
  if (a.type === 2 || a.type === 1) {
    if (a.score > b.score) return 1;
    if (a.score < b.score) return -1;
    if (a.gong > b.gong) return 1;
    if (a.gong < b.gong) return -1;
    if (a.major > b.major) return 1;
    if (a.major < b.major) return -1;
    const order = { "♠": 4, "♥": 3, "♣": 2, "♦": 1 };
    if (order[a.suit] > order[b.suit]) return 1;
    if (order[a.suit] < order[b.suit]) return -1;
    return 0;
  }
  return 0;
}
