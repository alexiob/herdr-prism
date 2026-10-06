# Disposable actual SSH server. Release and fixture public key are supplied only
# at runtime; no host user files or private SSH identities enter the image.
FROM docker.io/library/node:24-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends openssh-server git python3 procps ca-certificates && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --shell /bin/sh prism && passwd -d prism && mkdir -p /run/sshd /home/prism/.ssh && chmod 700 /home/prism/.ssh
RUN printf '%s\n' 'Port 22' 'ListenAddress 0.0.0.0' 'HostKey /etc/ssh/ssh_host_ed25519_key' 'PasswordAuthentication no' 'KbdInteractiveAuthentication no' 'PermitRootLogin no' 'PubkeyAuthentication yes' 'AuthorizedKeysFile .ssh/authorized_keys' 'AllowUsers prism' 'AllowTcpForwarding yes' 'AllowStreamLocalForwarding yes' 'PermitTTY yes' 'UsePAM no' > /etc/ssh/sshd_config
RUN rm -f /etc/ssh/ssh_host_*
EXPOSE 22
CMD ["sh", "-c", "install -m 600 -o prism -g prism /run/fixture-authorized-key /home/prism/.ssh/authorized_keys && chown prism:prism /home/prism/.ssh && ssh-keygen -A >/dev/null && exec /usr/sbin/sshd -D -e"]
