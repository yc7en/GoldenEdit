// Package fs 负责文件 IO、vault 扫描、最近文件记录。
package fs

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Service 暴露给前端的文件服务。
type Service struct {
	ctx context.Context
}

func NewService() *Service { return &Service{} }

func (s *Service) Attach(ctx context.Context) { s.ctx = ctx }

// FileNode 文件树节点。
type FileNode struct {
	Name  string     `json:"name"`
	Path  string     `json:"path"`
	Dir   bool       `json:"dir"`
	Files []FileNode `json:"files,omitempty"`
}

// ListVault 扫描目录下的 .md 文件，返回文件树。
func (s *Service) ListVault(dir string) (FileNode, error) {
	info, err := os.Stat(dir)
	if err != nil {
		return FileNode{}, err
	}
	root := FileNode{Name: filepath.Base(dir), Path: dir, Dir: true}
	if info.IsDir() {
		root.Files = scanDir(dir)
	}
	return root, nil
}

func scanDir(dir string) []FileNode {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var nodes []FileNode
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".") {
			continue
		}
		p := filepath.Join(dir, e.Name())
		if e.IsDir() {
			nodes = append(nodes, FileNode{
				Name:  e.Name(),
				Path:  p,
				Dir:   true,
				Files: scanDir(p),
			})
		} else if strings.HasSuffix(strings.ToLower(e.Name()), ".md") {
			nodes = append(nodes, FileNode{Name: e.Name(), Path: p, Dir: false})
		}
	}
	sort.Slice(nodes, func(i, j int) bool {
		if nodes[i].Dir != nodes[j].Dir {
			return nodes[i].Dir
		}
		return strings.ToLower(nodes[i].Name) < strings.ToLower(nodes[j].Name)
	})
	return nodes
}

// ReadFile 读取文本文件。
func (s *Service) ReadFile(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// WriteFile 写回文本文件。
func (s *Service) WriteFile(path, content string) error {
	return os.WriteFile(path, []byte(content), 0644)
}
