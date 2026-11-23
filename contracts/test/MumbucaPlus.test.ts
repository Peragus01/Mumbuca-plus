import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

const E18 = 10n ** 18n;
const CAP = 10_000_000n * E18;
const MAX_TX = 20_000n * E18;
const ref = (s: string) => ethers.id(s);

describe("MumbucaPlus", () => {
  async function deploy() {
    const [admin, minter, user, other] = await ethers.getSigners();
    const token = await ethers.deployContract("MumbucaPlus", [admin.address, CAP, MAX_TX]);
    await token.connect(admin).grantRole(await token.MINTER_ROLE(), minter.address);
    return { token, admin, minter, user, other };
  }

  it("has name Mumbuca+, symbol Mum+, 18 decimals, zero supply", async () => {
    const { token } = await loadFixture(deploy);
    expect(await token.name()).to.equal("Mumbuca+");
    expect(await token.symbol()).to.equal("Mum+");
    expect(await token.decimals()).to.equal(18n);
    expect(await token.totalSupply()).to.equal(0n);
    expect(await token.cap()).to.equal(CAP);
    expect(await token.maxMintPerTx()).to.equal(MAX_TX);
  });

  it("minter mints amount to wallet and emits Transfer and MintedForPayment(to, amount, ref)", async () => {
    const { token, minter, user } = await loadFixture(deploy);
    const r = ref("pix-1");
    await expect(token.connect(minter).mint(user.address, 100n * E18, r))
      .to.emit(token, "Transfer").withArgs(ethers.ZeroAddress, user.address, 100n * E18)
      .and.to.emit(token, "MintedForPayment").withArgs(user.address, 100n * E18, r);
    expect(await token.balanceOf(user.address)).to.equal(100n * E18);
  });

  it("reverts PaymentRefAlreadyUsed on second mint with same ref", async () => {
    const { token, minter, user } = await loadFixture(deploy);
    const r = ref("pix-1");
    expect(await token.paymentRefUsed(r)).to.equal(false);
    await token.connect(minter).mint(user.address, 1n * E18, r);
    expect(await token.paymentRefUsed(r)).to.equal(true);
    await expect(token.connect(minter).mint(user.address, 1n * E18, r))
      .to.be.revertedWithCustomError(token, "PaymentRefAlreadyUsed").withArgs(r);
  });

  it("reverts AccessControlUnauthorizedAccount when non-minter mints", async () => {
    const { token, user, other } = await loadFixture(deploy);
    await expect(token.connect(other).mint(user.address, E18, ref("a")))
      .to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount")
      .withArgs(other.address, await token.MINTER_ROLE());
  });

  it("admin without MINTER_ROLE cannot mint", async () => {
    const { token, admin, user } = await loadFixture(deploy);
    await expect(token.connect(admin).mint(user.address, E18, ref("a")))
      .to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
  });

  it("reverts MintAmountExceedsLimit above maxMintPerTx", async () => {
    const { token, minter, user } = await loadFixture(deploy);
    await expect(token.connect(minter).mint(user.address, MAX_TX + 1n, ref("a")))
      .to.be.revertedWithCustomError(token, "MintAmountExceedsLimit").withArgs(MAX_TX + 1n, MAX_TX);
  });

  it("admin can raise maxMintPerTx", async () => {
    const { token, admin, minter, user, other } = await loadFixture(deploy);
    await expect(token.connect(other).setMaxMintPerTx(MAX_TX * 2n))
      .to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    await token.connect(admin).setMaxMintPerTx(MAX_TX * 2n);
    expect(await token.maxMintPerTx()).to.equal(MAX_TX * 2n);
    await token.connect(minter).mint(user.address, MAX_TX + 1n, ref("a"));
    expect(await token.balanceOf(user.address)).to.equal(MAX_TX + 1n);
  });

  it("reverts InvalidMintAmount for zero", async () => {
    const { token, minter, user } = await loadFixture(deploy);
    await expect(token.connect(minter).mint(user.address, 0n, ref("a")))
      .to.be.revertedWithCustomError(token, "InvalidMintAmount");
  });

  it("reverts ERC20InvalidReceiver for address(0)", async () => {
    const { token, minter } = await loadFixture(deploy);
    await expect(token.connect(minter).mint(ethers.ZeroAddress, E18, ref("a")))
      .to.be.revertedWithCustomError(token, "ERC20InvalidReceiver").withArgs(ethers.ZeroAddress);
  });

  it("reverts ERC20ExceededCap beyond cap", async () => {
    const { token, admin, minter, user } = await loadFixture(deploy);
    await token.connect(admin).setMaxMintPerTx(CAP);
    await token.connect(minter).mint(user.address, CAP, ref("a"));
    await expect(token.connect(minter).mint(user.address, 1n, ref("b")))
      .to.be.revertedWithCustomError(token, "ERC20ExceededCap").withArgs(CAP + 1n, CAP);
  });

  it("pause blocks mint with EnforcedPause but transfers still work", async () => {
    const { token, admin, minter, user, other } = await loadFixture(deploy);
    await token.connect(minter).mint(user.address, 10n * E18, ref("a"));
    await token.connect(admin).pause();
    expect(await token.paused()).to.equal(true);
    await expect(token.connect(minter).mint(user.address, E18, ref("b")))
      .to.be.revertedWithCustomError(token, "EnforcedPause");
    await token.connect(user).transfer(other.address, 4n * E18);
    expect(await token.balanceOf(other.address)).to.equal(4n * E18);
  });

  it("unpause restores mint", async () => {
    const { token, admin, minter, user } = await loadFixture(deploy);
    await token.connect(admin).pause();
    await token.connect(admin).unpause();
    await token.connect(minter).mint(user.address, E18, ref("a"));
    expect(await token.balanceOf(user.address)).to.equal(E18);
  });

  it("non-pauser cannot pause", async () => {
    const { token, other } = await loadFixture(deploy);
    await expect(token.connect(other).pause())
      .to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount")
      .withArgs(other.address, await token.PAUSER_ROLE());
  });
});
