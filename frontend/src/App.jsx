import { useEffect, useState, useCallback, useRef } from 'react'
import WarehouseScene from './WarehouseScene.jsx'

const API_BASE = '/api'

export default function App() {
  const [warehouse, setWarehouse] = useState(null)
  const [shelves, setShelves] = useState([])
  const [agvs, setAgvs] = useState([])
  const [summary, setSummary] = useState({ totalSlots: 0, occupiedSlots: 0, agvCount: 0, shelfCount: 0 })
  const [connected, setConnected] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(null)
  const [tick, setTick] = useState(0)

  const [selectedSlot, setSelectedSlot] = useState(null)
  const [slotDetail, setSlotDetail] = useState(null)
  const [slotLoading, setSlotLoading] = useState(false)
  const [bubblePos, setBubblePos] = useState({ x: 0, y: 0, visible: false })
  const appRef = useRef(null)

  useEffect(() => {
    const fetchInitial = async () => {
      try {
        const res = await fetch(`${API_BASE}/status`, { cache: 'no-store' })
        if (!res.ok) throw new Error('status err')
        const json = await res.json()
        if (json.success) {
          setWarehouse(json.data.warehouse)
          setShelves(json.data.shelves)
          setAgvs(json.data.agvs)
          setSummary(json.data.summary)
          setConnected(true)
          setLastUpdate(new Date())
        }
      } catch (e) {
        setConnected(false)
      }
    }
    fetchInitial()
  }, [])

  useEffect(() => {
    if (!warehouse) return
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/agvs`, { cache: 'no-store' })
        if (!res.ok) throw new Error()
        const json = await res.json()
        if (json.success) {
          setAgvs(json.data)
          setConnected(true)
          setLastUpdate(new Date())
          setTick((t) => t + 1)
        }
      } catch {
        setConnected(false)
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [warehouse])

  const handleSlotClick = useCallback(async (slotInfo, screenPos) => {
    if (!slotInfo) {
      setSelectedSlot(null)
      setSlotDetail(null)
      setBubblePos({ x: 0, y: 0, visible: false })
      return
    }

    setSelectedSlot(slotInfo)
    setSlotLoading(true)
    setSlotDetail(null)

    try {
      const res = await fetch(
        `${API_BASE}/shelves/${slotInfo.shelfId}/slots/${slotInfo.row}/${slotInfo.level}/${slotInfo.column}`,
        { cache: 'no-store' }
      )
      const json = await res.json()
      if (json.success) {
        setSlotDetail(json.data)
      }
    } catch (e) {
      console.error('加载货位详情失败', e)
    } finally {
      setSlotLoading(false)
    }

    const appRect = appRef.current?.getBoundingClientRect()
    if (appRect) {
      setBubblePos({
        x: screenPos.x - appRect.left,
        y: screenPos.y - appRect.top,
        visible: true,
      })
    }
  }, [])

  const closeBubble = () => {
    setSelectedSlot(null)
    setSlotDetail(null)
    setBubblePos({ x: 0, y: 0, visible: false })
  }

  const formatTime = (d) => {
    if (!d) return '--'
    return d.toLocaleTimeString('zh-CN', { hour12: false })
  }

  const formatStockIn = (iso) => {
    if (!iso) return '--'
    const d = new Date(iso)
    return d.toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
  }

  const getBatteryClass = (b) => (b > 60 ? 'high' : b > 30 ? 'med' : 'low')

  const getStatusText = (s) =>
    s === 'working' ? '作业中' : s === 'charging' ? '充电中' : s === 'idle' ? '空闲' : s

  const getDaysStoredBadge = (days) => {
    if (days >= 60) return { text: `存放 ${days} 天`, color: '#ef4444', bg: 'rgba(239,68,68,0.12)' }
    if (days >= 30) return { text: `存放 ${days} 天`, color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' }
    return { text: `存放 ${days} 天`, color: '#10b981', bg: 'rgba(16,185,129,0.12)' }
  }

  return (
    <div className="app-container" ref={appRef} onClick={(e) => {
      if (e.target === appRef.current || e.target.classList.contains('canvas-container')) {
        closeBubble()
      }
    }}>
      <WarehouseScene
        warehouse={warehouse}
        shelves={shelves}
        agvs={agvs}
        selectedSlot={selectedSlot}
        onSlotClick={handleSlotClick}
      />

      <div className="info-panel">
        <div className="panel-title">立体仓库监控中心</div>

        <div className="summary-grid">
          <div className="summary-item">
            <div className="summary-label">货架数量</div>
            <div className="summary-value accent">{summary.shelfCount}</div>
          </div>
          <div className="summary-item">
            <div className="summary-label">AGV 小车</div>
            <div className="summary-value accent">{summary.agvCount}</div>
          </div>
          <div className="summary-item">
            <div className="summary-label">总货位</div>
            <div className="summary-value">{summary.totalSlots}</div>
          </div>
          <div className="summary-item">
            <div className="summary-label">占用货位</div>
            <div className="summary-value success">{summary.occupiedSlots}</div>
          </div>
        </div>

        <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10 }}>AGV 运行状态</div>

        <div className="agv-list">
          {agvs.map((agv) => (
            <div key={agv.id} className={`agv-item ${agv.status}`}>
              <div>
                <div className="agv-name">
                  <span className="agent-tag">
                    <span
                      className="agent-dot"
                      style={{
                        background:
                          agv.status === 'working'
                            ? '#3b82f6'
                            : agv.status === 'charging'
                            ? '#fbbf24'
                            : '#64748b',
                      }}
                    />
                    {agv.name}
                  </span>
                </div>
                <div className="agv-info">
                  X:{agv.position.x.toFixed(1)} Z:{agv.position.z.toFixed(1)}
                  <span className="battery-bar">
                    <span
                      className={`battery-fill ${getBatteryClass(agv.battery)}`}
                      style={{ width: `${agv.battery}%` }}
                    />
                  </span>
                  {agv.battery.toFixed(0)}%
                </div>
              </div>
              <div className={`agv-status ${agv.status}`}>{getStatusText(agv.status)}</div>
            </div>
          ))}
          {agvs.length === 0 && (
            <div style={{ fontSize: 12, color: '#64748b', padding: 10, textAlign: 'center' }}>
              等待数据加载...
            </div>
          )}
        </div>
      </div>

      <div className="control-panel">
        <div className="control-title">实时监控</div>
        <div className="control-row">
          <span className="control-label">连接状态</span>
          <span
            className="control-value"
            style={{ color: connected ? '#34d399' : '#ef4444' }}
          >
            {connected ? '● 已连接' : '● 已断开'}
          </span>
        </div>
        <div className="control-row">
          <span className="control-label">轮询次数</span>
          <span className="control-value">{tick}</span>
        </div>
        <div className="control-row">
          <span className="control-label">最后更新</span>
          <span className="control-value">{formatTime(lastUpdate)}</span>
        </div>
        <div className="control-row">
          <span className="control-label">仓库尺寸</span>
          <span className="control-value">
            {warehouse ? `${warehouse.width}×${warehouse.length}×${warehouse.height}` : '--'}
          </span>
        </div>
        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: '1px solid rgba(59,130,246,0.15)',
            fontSize: 11,
            color: '#64748b',
            lineHeight: 1.7,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, background: '#3b82f6', borderRadius: 2 }} />
            蓝色：作业中小车
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, background: '#fbbf24', borderRadius: 2 }} />
            黄色：充电中小车
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, background: '#64748b', borderRadius: 2 }} />
            灰色：空闲小车
          </div>
        </div>
      </div>

      <div className="hint-panel">
        <div className="hint-title">操作提示</div>
        <div>
          <b>鼠标左键拖拽</b>：旋转视角　
          <b>滚轮</b>：缩放场景　
          <b>右键拖拽</b>：平移画面
        </div>
        <div style={{ marginTop: 4 }}>
          <b style={{ color: '#60a5fa' }}>点击货位</b>：查看货物详情
        </div>
      </div>

      {bubblePos.visible && (
        <div
          className="slot-bubble"
          style={{
            left: bubblePos.x,
            top: bubblePos.y,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bubble-close" onClick={closeBubble} title="关闭">×</div>
          {slotLoading && (
            <div className="bubble-loading">
              <div className="spinner" />
              <span>加载货位详情...</span>
            </div>
          )}
          {!slotLoading && slotDetail && (
            <>
              <div className="bubble-header">
                <div className="bubble-icon">📦</div>
                <div>
                  <div className="bubble-title">{slotDetail.slotId}</div>
                  <div className="bubble-subtitle">
                    {slotDetail.shelfId} · 第{slotDetail.row + 1}排 · 第{slotDetail.level + 1}层 · 第{slotDetail.column + 1}列
                  </div>
                </div>
              </div>

              {slotDetail.occupied ? (
                <>
                  <div className="bubble-divider" />
                  <div className="bubble-row">
                    <span className="bubble-label">货物名称</span>
                    <span className="bubble-value strong" style={{
                      color: slotDetail.cargo?.color || '#fff',
                    }}>
                      {slotDetail.cargo?.name}
                    </span>
                  </div>
                  <div className="bubble-row">
                    <span className="bubble-label">货物类别</span>
                    <span className="bubble-value">
                      <span className="category-tag">{slotDetail.cargo?.category || '--'}</span>
                    </span>
                  </div>
                  <div className="bubble-row">
                    <span className="bubble-label">入库时间</span>
                    <span className="bubble-value">{formatStockIn(slotDetail.cargo?.stockInTime)}</span>
                  </div>
                  <div className="bubble-row">
                    <span className="bubble-label">货物重量</span>
                    <span className="bubble-value">{slotDetail.cargo?.weightKg?.toFixed(1) || '--'} kg</span>
                  </div>
                  <div className="bubble-row">
                    <span className="bubble-label">存放时长</span>
                    <span className="bubble-value">
                      <span
                        className="days-badge"
                        style={{
                          color: getDaysStoredBadge(slotDetail.daysStored).color,
                          background: getDaysStoredBadge(slotDetail.daysStored).bg,
                        }}
                      >
                        {getDaysStoredBadge(slotDetail.daysStored).text}
                      </span>
                    </span>
                  </div>
                  <div className="bubble-row">
                    <span className="bubble-label">占用状态</span>
                    <span className="bubble-value status-badge occupied">● 已占用</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="bubble-divider" />
                  <div className="bubble-empty">
                    <div className="empty-icon">📭</div>
                    <div className="empty-text">此货位当前为空</div>
                    <div className="empty-sub">可用于存放新货物</div>
                  </div>
                </>
              )}

              <div className="bubble-pointer" />
            </>
          )}
        </div>
      )}
    </div>
  )
}
