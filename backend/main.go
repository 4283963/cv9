package main

import (
	"fmt"
	"math"
	"math/rand"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type Position struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

type AGV struct {
	ID       string    `json:"id"`
	Name     string    `json:"name"`
	Position Position  `json:"position"`
	Status   string    `json:"status"`
	Battery  float64   `json:"battery"`
	Target   *Position `json:"target,omitempty"`
	Speed    float64   `json:"speed"`
}

type Cargo struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Occupied    bool      `json:"occupied"`
	Color       string    `json:"color"`
	StockInTime time.Time `json:"stockInTime"`
	WeightKG    float64   `json:"weightKg"`
	Category    string    `json:"category"`
}

type ShelfSlot struct {
	Row    int    `json:"row"`
	Level  int    `json:"level"`
	Column int    `json:"column"`
	Cargo  *Cargo `json:"cargo"`
}

type Shelf struct {
	ID       string      `json:"id"`
	Position Position    `json:"position"`
	Rows     int         `json:"rows"`
	Levels   int         `json:"levels"`
	Columns  int         `json:"columns"`
	Slots    []ShelfSlot `json:"slots"`
}

type Warehouse struct {
	Width  float64 `json:"width"`
	Length float64 `json:"length"`
	Height float64 `json:"height"`
}

var (
	mu               sync.RWMutex
	agvs             map[string]*AGV
	shelves          []*Shelf
	warehouse        Warehouse
	shelfWidth       float64 = 2.0
	shelfDepth       float64 = 1.0
	shelfLevelHeight float64 = 1.2
	aisleWidth       float64 = 3.0
)

func initWarehouse() {
	warehouse = Warehouse{
		Width:  30,
		Length: 25,
		Height: 8,
	}

	agvs = make(map[string]*AGV)
	agvs["agv-1"] = &AGV{
		ID: "agv-1", Name: "AGV-001",
		Position: Position{X: 2, Y: 0.3, Z: 2},
		Status:   "idle",
		Battery:  85.5,
		Target:   &Position{X: 10, Y: 0.3, Z: 9},
		Speed:    1.2,
	}
	agvs["agv-2"] = &AGV{
		ID: "agv-2", Name: "AGV-002",
		Position: Position{X: 10, Y: 0.3, Z: 15},
		Status:   "working",
		Battery:  72.3,
		Target:   &Position{X: 28, Y: 0.3, Z: 9},
		Speed:    1.0,
	}
	agvs["agv-3"] = &AGV{
		ID: "agv-3", Name: "AGV-003",
		Position: Position{X: 28, Y: 0.3, Z: 22},
		Status:   "charging",
		Battery:  45.0,
		Target:   nil,
		Speed:    0,
	}
	agvs["agv-4"] = &AGV{
		ID: "agv-4", Name: "AGV-004",
		Position: Position{X: 9, Y: 0.3, Z: 15},
		Status:   "working",
		Battery:  91.2,
		Target:   &Position{X: 20, Y: 0.3, Z: 22},
		Speed:    1.5,
	}

	initShelves()
}

func initShelves() {
	shelfConfig := []struct {
		posX, posZ         float64
		rows, cols, levels int
	}{
		{5, 6, 2, 4, 3},
		{5, 12, 2, 4, 3},
		{5, 18, 2, 4, 3},
		{15, 6, 2, 4, 3},
		{15, 12, 2, 4, 3},
		{15, 18, 2, 4, 3},
		{25, 6, 2, 4, 3},
		{25, 18, 2, 4, 3},
	}

	cargoColors := []string{"#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6", "#1abc9c", "#e67e22", "#34495e"}
	cargoCategories := []string{"电子产品", "服装鞋帽", "食品饮料", "日用百货", "工业零件", "图书文具", "医疗用品", "家居建材"}

	for idx, cfg := range shelfConfig {
		shelfID := fmtShelfID(idx)
		shelf := &Shelf{
			ID: shelfID,
			Position: Position{
				X: cfg.posX,
				Y: 0,
				Z: cfg.posZ,
			},
			Rows:    cfg.rows,
			Levels:  cfg.levels,
			Columns: cfg.cols,
			Slots:   make([]ShelfSlot, 0),
		}

		for r := 0; r < cfg.rows; r++ {
			for l := 0; l < cfg.levels; l++ {
				for c := 0; c < cfg.cols; c++ {
					slot := ShelfSlot{
						Row:    r,
						Level:  l,
						Column: c,
						Cargo:  nil,
					}
					if rand.Float64() > 0.55 {
						color := cargoColors[rand.Intn(len(cargoColors))]
						daysAgo := rand.Intn(90)
						hours := rand.Intn(24)
						minutes := rand.Intn(60)
						stockIn := time.Now().AddDate(0, 0, -daysAgo).Truncate(24 * time.Hour).Add(time.Duration(hours)*time.Hour + time.Duration(minutes)*time.Minute)
						slot.Cargo = &Cargo{
							ID:          fmt.Sprintf("%s-slot-%d-%d-%d", shelfID, r, l, c),
							Name:        fmt.Sprintf("货物-%d", rand.Intn(10000)),
							Occupied:    true,
							Color:       color,
							StockInTime: stockIn,
							WeightKG:    5 + rand.Float64()*95,
							Category:    cargoCategories[rand.Intn(len(cargoCategories))],
						}
					}
					shelf.Slots = append(shelf.Slots, slot)
				}
			}
		}
		shelves = append(shelves, shelf)
	}
}

func fmtShelfID(i int) string {
	return fmt.Sprintf("SHELF-%03d", i+1)
}

func moveAGVs() {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for range ticker.C {
		mu.Lock()
		for _, agv := range agvs {
			if agv.Target == nil || agv.Status == "charging" {
				continue
			}
			dx := agv.Target.X - agv.Position.X
			dz := agv.Target.Z - agv.Position.Z
			dist := math.Sqrt(dx*dx + dz*dz)
			if dist < 0.1 {
				newTarget := randomTarget()
				agv.Target = &newTarget
				if agv.Battery > 10 {
					agv.Battery -= 0.05
				}
				continue
			}
			step := agv.Speed * 0.1
			if step > dist {
				step = dist
			}
			agv.Position.X += (dx / dist) * step
			agv.Position.Z += (dz / dist) * step
			if agv.Position.X < 1 {
				agv.Position.X = 1
			}
			if agv.Position.X > warehouse.Width-1 {
				agv.Position.X = warehouse.Width - 1
			}
			if agv.Position.Z < 1 {
				agv.Position.Z = 1
			}
			if agv.Position.Z > warehouse.Length-1 {
				agv.Position.Z = warehouse.Length - 1
			}
		}
		mu.Unlock()
	}
}

func randomTarget() Position {
	xCandidates := []float64{
		1.5 + rand.Float64()*1.5,
		7.5 + rand.Float64()*5.0,
		17.5 + rand.Float64()*5.0,
		27.0 + rand.Float64()*1.5,
	}
	zCandidates := []float64{
		1.5 + rand.Float64()*1.5,
		8.0 + rand.Float64()*2.0,
		14.0 + rand.Float64()*2.0,
		20.0 + rand.Float64()*3.5,
	}
	return Position{
		X: xCandidates[rand.Intn(len(xCandidates))],
		Y: 0.3,
		Z: zCandidates[rand.Intn(len(zCandidates))],
	}
}

func getAGVsHandler(c *gin.Context) {
	mu.RLock()
	defer mu.RUnlock()
	list := make([]*AGV, 0, len(agvs))
	for _, agv := range agvs {
		list = append(list, agv)
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    list,
	})
}

func getShelvesHandler(c *gin.Context) {
	mu.RLock()
	defer mu.RUnlock()
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    shelves,
	})
}

func getWarehouseHandler(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    warehouse,
	})
}

func getStatusHandler(c *gin.Context) {
	mu.RLock()
	defer mu.RUnlock()
	agvList := make([]*AGV, 0, len(agvs))
	for _, agv := range agvs {
		agvList = append(agvList, agv)
	}

	totalSlots := 0
	occupiedSlots := 0
	for _, s := range shelves {
		totalSlots += len(s.Slots)
		for _, slot := range s.Slots {
			if slot.Cargo != nil {
				occupiedSlots++
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"warehouse": warehouse,
			"agvs":      agvList,
			"shelves":   shelves,
			"summary": gin.H{
				"totalSlots":    totalSlots,
				"occupiedSlots": occupiedSlots,
				"agvCount":      len(agvs),
				"shelfCount":    len(shelves),
			},
		},
	})
}

func setAGVTargetHandler(c *gin.Context) {
	id := c.Param("id")
	var req struct {
		X float64 `json:"x" binding:"required"`
		Z float64 `json:"z" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "参数错误"})
		return
	}

	mu.Lock()
	defer mu.Unlock()
	agv, exists := agvs[id]
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "AGV不存在"})
		return
	}
	agv.Target = &Position{X: req.X, Y: 0.3, Z: req.Z}
	if agv.Status == "charging" {
		agv.Status = "working"
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "目标已设置", "data": agv})
}

func getSlotDetailHandler(c *gin.Context) {
	shelfID := c.Param("shelfId")
	row, err1 := strconv.Atoi(c.Param("row"))
	level, err2 := strconv.Atoi(c.Param("level"))
	column, err3 := strconv.Atoi(c.Param("column"))
	if err1 != nil || err2 != nil || err3 != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "参数错误"})
		return
	}

	mu.RLock()
	defer mu.RUnlock()

	var shelf *Shelf
	for _, s := range shelves {
		if s.ID == shelfID {
			shelf = s
			break
		}
	}
	if shelf == nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "货架不存在"})
		return
	}

	var slot *ShelfSlot
	for i := range shelf.Slots {
		s := &shelf.Slots[i]
		if s.Row == row && s.Level == level && s.Column == column {
			slot = s
			break
		}
	}
	if slot == nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "货位不存在"})
		return
	}

	slotID := fmt.Sprintf("%s-R%d-L%d-C%d", shelfID, row, level, column)

	var daysStored int
	if slot.Cargo != nil {
		daysStored = int(time.Since(slot.Cargo.StockInTime).Hours() / 24)
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"slotId":     slotID,
			"shelfId":    shelfID,
			"row":        row,
			"level":      level,
			"column":     column,
			"occupied":   slot.Cargo != nil,
			"shelfPos":   shelf.Position,
			"cargo":      slot.Cargo,
			"daysStored": daysStored,
		},
	})
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

func main() {
	rand.Seed(time.Now().UnixNano())
	initWarehouse()
	go moveAGVs()

	r := gin.Default()
	r.Use(corsMiddleware())

	api := r.Group("/api")
	{
		api.GET("/status", getStatusHandler)
		api.GET("/warehouse", getWarehouseHandler)
		api.GET("/agvs", getAGVsHandler)
		api.GET("/shelves", getShelvesHandler)
		api.GET("/shelves/:shelfId/slots/:row/:level/:column", getSlotDetailHandler)
		api.POST("/agvs/:id/target", setAGVTargetHandler)
	}

	r.Run(":8080")
}
