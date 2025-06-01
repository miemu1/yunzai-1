import { promises as fs } from "node:fs";
import path from "node:path";

const dataDir = path.join(process.cwd(), "plugins/xianxin-plugin/data/game/");

export default class GameDB {
  static async ensureDir() {
    await fs.mkdir(dataDir, { recursive: true });
  }

  static file(userId) {
    return path.join(dataDir, `${userId}.json`);
  }

  static defaultData(userId) {
    return {
      user_id: userId,
      coins: String(userId).startsWith("bot_") ? 1000000 : 10000,
      wins: { gobang: 0, blackjack: 0, douniu: 0 },
      total: { gobang: 0, blackjack: 0, douniu: 0 },
    };
  }

  static async ensureUser(userId) {
    await this.ensureDir();
    const file = this.file(userId);
    try {
      await fs.access(file);
    } catch (e) {
      const data = this.defaultData(userId);
      await fs.writeFile(file, JSON.stringify(data, null, 2));
    }
  }

  static async read(userId) {
    await this.ensureUser(userId);
    const file = this.file(userId);
    const content = await fs.readFile(file, "utf8");
    return JSON.parse(content);
  }

  static async write(userId, data) {
    await fs.writeFile(this.file(userId), JSON.stringify(data, null, 2));
  }

  static async getCoins(userId) {
    const data = await this.read(userId);
    return data.coins || 0;
  }

  static async setCoins(userId, coins) {
    const data = await this.read(userId);
    data.coins = Math.max(0, parseInt(coins) || 0);
    await this.write(userId, data);
    return data.coins;
  }

  static async addCoins(userId, amount) {
    const data = await this.read(userId);
    data.coins += parseInt(amount) || 0;
    if (data.coins < 0) data.coins = 0;
    await this.write(userId, data);
    return data.coins;
  }

  static async deductCoins(userId, amount) {
    amount = parseInt(amount);
    if (isNaN(amount) || amount <= 0) return false;
    const data = await this.read(userId);
    if (data.coins < amount) return false;
    data.coins -= amount;
    await this.write(userId, data);
    return true;
  }

  static async updateDouniu(userId, win) {
    const data = await this.read(userId);
    data.total.douniu = (data.total.douniu || 0) + 1;
    if (win) data.wins.douniu = (data.wins.douniu || 0) + 1;
    await this.write(userId, data);
  }

  static async updateBlackjack(userId, win) {
    const data = await this.read(userId);
    data.total.blackjack = (data.total.blackjack || 0) + 1;
    if (win) data.wins.blackjack = (data.wins.blackjack || 0) + 1;
    await this.write(userId, data);
  }

  /**
   * 获取指定用户的游戏统计信息
   * @param {string|number} userId - 用户ID
   * @param {string} [game="blackjack"] - 游戏名称
   * @returns {{win:number,total:number}}
   */
  static async getStats(userId, game = "blackjack") {
    const data = await this.read(userId);
    return {
      win: data.wins?.[game] || 0,
      total: data.total?.[game] || 0,
    };
  }

  static async getTopCoins(limit = 10) {
    await this.ensureDir();
    const files = await fs.readdir(dataDir);
    const players = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const json = JSON.parse(
        await fs.readFile(path.join(dataDir, file), 'utf8')
      );
      players.push({
        user_id: json.user_id || file.replace('.json', ''),
        coins: json.coins || 0,
      });
    }
    players.sort((a, b) => b.coins - a.coins);
    return players.slice(0, limit);
  }
}
