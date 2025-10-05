import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons, Feather } from '@expo/vector-icons';

const BottomNavBar = ({ activeTab, onTabPress }) => {
  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => onTabPress('dataBank')} style={styles.tab}>
        <MaterialIcons
          name="apps"
          size={24}
          color={activeTab === 'dataBank' ? '#007AFF' : '#666'}
        />
        <Text style={[styles.label, activeTab === 'dataBank' && styles.activeLabel]}>
          Data Bank
        </Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => onTabPress('map')} style={styles.tab}>
        <Feather
          name="map"
          size={24}
          color={activeTab === 'map' ? '#007AFF' : '#666'}
        />
        <Text style={[styles.label, activeTab === 'map' && styles.activeLabel]}>Map</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => onTabPress('download')} style={styles.tab}>
        <Feather
          name="download"
          size={24}
          color={activeTab === 'download' ? '#007AFF' : '#666'}
        />
        <Text style={[styles.label, activeTab === 'download' && styles.activeLabel]}>
          Data Bank
        </Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => onTabPress('more')} style={styles.tab}>
        <Feather
          name="more-horizontal"
          size={24}
          color={activeTab === 'more' ? '#007AFF' : '#666'}
        />
        <Text style={[styles.label, activeTab === 'more' && styles.activeLabel]}>More</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#fff',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  tab: {
    alignItems: 'center',
  },
  label: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  activeLabel: {
    color: '#007AFF',
    fontWeight: '600',
  },
});

export default BottomNavBar;
