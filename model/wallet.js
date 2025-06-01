import base from "./base.js";
import GameDB from "./gamedb.js";

export default class Wallet extends base {
  constructor(e) {
    super(e);
    this.model = "wallet";
  }

  /** 获取余额，如无记录则初始化 */
  async getBalance() {
    return await GameDB.getCoins(this.userId);
  }

  /** 设置余额 */
  async setBalance(amount) {
    return await GameDB.setCoins(this.userId, amount);
  }

  /** 增加金币 */
  async add(amount) {
    return await GameDB.addCoins(this.userId, amount);
  }

  /** 扣除金币，余额不足返回false */
  async deduct(amount) {
    return await GameDB.deductCoins(this.userId, amount);
  }
}