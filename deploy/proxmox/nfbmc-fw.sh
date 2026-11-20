#!/bin/sh
# Uso: nfbmc-fw.sh up|down <bridge> <subnet>
# NAT para a internet + bloqueio de redes privadas e do próprio host (IPv4 e IPv6).
ACTION="$1"; BR="$2"; NET="$3"
WAN=vmbr0
PRIV="10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 169.254.0.0/16"

rule() { # rule <iptables|ip6tables> <tabela> <chain> <args...>
  cmd="$1"; t="$2"; c="$3"; shift 3
  if [ "$ACTION" = up ]; then
    $cmd -t "$t" -C "$c" "$@" 2>/dev/null || $cmd -t "$t" -I "$c" "$@"
  else
    while $cmd -t "$t" -D "$c" "$@" 2>/dev/null; do :; done
  fi
}

[ "$ACTION" = up ] && sysctl -qw net.ipv4.ip_forward=1

rule iptables nat POSTROUTING -s "$NET" -o "$WAN" -j MASQUERADE
for d in $PRIV; do
  rule iptables filter FORWARD -s "$NET" -d "$d" -j DROP
done
rule iptables  filter INPUT   -i "$BR" -j DROP
rule ip6tables filter INPUT   -i "$BR" -j DROP
rule ip6tables filter FORWARD -i "$BR" -j DROP
