import { describe, it, expect } from 'vitest'
import { parseVer, compareVersions } from '../electron/version'

describe('parseVer', () => {
  it('解析标准三段版本', () => {
    expect(parseVer('0.10.0')).toEqual([0, 10, 0])
    expect(parseVer('1.2.3')).toEqual([1, 2, 3])
    expect(parseVer('10.20.30')).toEqual([10, 20, 30])
  })
  it('忽略 v/V 前缀', () => {
    expect(parseVer('v0.9.3')).toEqual([0, 9, 3])
    expect(parseVer('V2.0.0')).toEqual([2, 0, 0])
  })
  it('忽略前后空白', () => {
    expect(parseVer('  0.10.0  ')).toEqual([0, 10, 0])
  })
  it('忽略预发布/构建后缀', () => {
    expect(parseVer('1.2.3-beta.1')).toEqual([1, 2, 3])
    expect(parseVer('0.10.0+build.5')).toEqual([0, 10, 0])
    expect(parseVer('v0.11.0-rc1')).toEqual([0, 11, 0])
  })
  it('非法/缺失值按 0.0.0', () => {
    expect(parseVer('abc')).toEqual([0, 0, 0])
    expect(parseVer('')).toEqual([0, 0, 0])
    expect(parseVer('1.2')).toEqual([0, 0, 0])
    expect(parseVer(null as unknown as string)).toEqual([0, 0, 0])
    expect(parseVer(undefined as unknown as string)).toEqual([0, 0, 0])
  })
})

describe('compareVersions', () => {
  it('相等返回 0（含 v 前缀差异）', () => {
    expect(compareVersions('0.10.0', '0.10.0')).toBe(0)
    expect(compareVersions('v0.10.0', '0.10.0')).toBe(0)
    expect(compareVersions('0.10.0', '0.10.0-rc1')).toBe(0)
  })
  it('逐段从左到右比较', () => {
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1)
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1)
    expect(compareVersions('0.0.2', '0.0.1')).toBe(1)
    expect(compareVersions('0.9.3', '0.10.0')).toBe(-1)
    expect(compareVersions('0.10.0', '0.10.1')).toBe(-1)
    expect(compareVersions('0.2.0', '0.10.0')).toBe(-1)
  })
  it('按数值而非字典序比较（关键：0.10.0 > 0.9.3）', () => {
    // 字典序会误判 '10' < '9'；必须按整数比较
    expect(compareVersions('0.10.0', '0.9.3')).toBe(1)
    expect(compareVersions('0.9.3', '0.10.0')).toBe(-1)
    expect(compareVersions('0.100.0', '0.99.0')).toBe(1)
  })
  it('预发布后缀不影响三段比较', () => {
    expect(compareVersions('0.11.0-beta', '0.10.0')).toBe(1)
    expect(compareVersions('1.2.3+build', '1.2.3')).toBe(0)
  })
  it('真实场景：本地 0.10.0 领先已发布 0.9.3 → 无更新', () => {
    const latest = '0.9.3'
    const current = '0.10.0'
    // hasUpdate = compareVersions(latest, current) > 0
    expect(compareVersions(latest, current) > 0).toBe(false)
  })
  it('真实场景：已发布 0.11.0 领先本地 0.10.0 → 有更新', () => {
    expect(compareVersions('0.11.0', '0.10.0') > 0).toBe(true)
    expect(compareVersions('v0.10.1', '0.10.0') > 0).toBe(true)
  })
})